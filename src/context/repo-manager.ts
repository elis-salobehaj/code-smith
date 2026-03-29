import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { getLogger } from "../logger";

const logger = getLogger(["codesmith", "repo-manager"]);

// ---------------------------------------------------------------------------
// buildGitEnv — pure helper exported for unit testing
//
// Builds the extra environment variables injected into every git subprocess.
// When a custom CA bundle is configured (self-hosted GitLab with an internal
// PKI), GIT_SSL_CAINFO points git at that file so TLS verification succeeds.
// The same file is set as NODE_EXTRA_CA_CERTS at startup (src/index.ts) for
// @gitbeaker/rest HTTP requests.
// ---------------------------------------------------------------------------
export function buildGitEnv(caFile?: string): Record<string, string> {
  if (caFile) {
    return { GIT_SSL_CAINFO: caFile };
  }
  return {};
}

export class RepoManager {
  private getCacheKey(projectId: number, branch: string): string {
    return `${projectId}-${encodeURIComponent(branch)}`;
  }

  /**
   * Clone the repository at `projectUrl` shallowly at `branch` into the cache
   * directory, or update the existing clone if it is already cached.
   * Returns the absolute path to the local clone.
   *
   * The GitLab token is injected as oauth2 credentials into the URL so git
   * can authenticate without SSH keys. The URL host is validated against
   * `config.GITLAB_URL` to prevent an SSRF attack via a malicious
   * webhook-supplied URL exfiltrating the token to a third-party host.
   */
  async cloneOrUpdate(
    projectUrl: string,
    branch: string,
    projectId: number,
    expectedHeadSha?: string,
  ): Promise<string> {
    const repoPath = this.getRepoPath(projectId, branch);
    const authedUrl = this.injectToken(projectUrl);

    const repoExists = await stat(join(repoPath, ".git"))
      .then(() => true)
      .catch(() => false);

    if (repoExists) {
      // Bring the existing clone up to date with a depth-1 fetch + hard reset.
      // Use an explicit refspec so the remote-tracking branch exists even in
      // shallow single-branch clones.
      await this.run(
        ["git", "fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`, "--depth", "1"],
        repoPath,
      );
      await this.run(["git", "reset", "--hard", `origin/${branch}`], repoPath);
    } else {
      // First time: ensure the cache directory exists, then do a shallow clone.
      await mkdir(config.REPO_CACHE_DIR, { recursive: true });
      await this.run(["git", "clone", "--depth", "1", "--branch", branch, authedUrl, repoPath]);
    }

    const localHeadSha = (await this.run(["git", "rev-parse", "HEAD"], repoPath)).trim();
    logger.debug("Prepared repo cache path", {
      requestedBranch: branch,
      expectedHeadSha,
      localHeadSha,
      cachePath: repoPath,
    });

    if (expectedHeadSha && localHeadSha !== expectedHeadSha) {
      throw new Error(
        `Local clone HEAD does not match GitLab MR head SHA: expected ${expectedHeadSha}, got ${localHeadSha}`,
      );
    }

    const now = new Date();
    await utimes(repoPath, now, now);

    return repoPath;
  }

  /**
   * Returns the expected on-disk path for a cached repo without performing
   * any I/O. Useful for downstream code that wants to build a path without
   * triggering a clone.
   */
  getRepoPath(projectId: number, branch: string): string {
    return join(config.REPO_CACHE_DIR, this.getCacheKey(projectId, branch));
  }

  /**
   * Remove cached clones whose directory mtime is older than `maxAgeSec`
   * seconds. Uses the directory's mtime as a proxy for last-accessed time.
   * Silently skips entries that disappear concurrently.
   */
  async cleanup(maxAgeSec = 3600): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(config.REPO_CACHE_DIR);
    } catch {
      return; // cache dir doesn't exist yet — nothing to clean
    }

    const cutoffMs = Date.now() - maxAgeSec * 1000;

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(config.REPO_CACHE_DIR, entry);
        try {
          const s = await stat(fullPath);
          if (s.mtimeMs < cutoffMs) {
            await rm(fullPath, { recursive: true, force: true });
          }
        } catch {
          // Ignore entries that disappear between readdir and stat (race).
        }
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Inject the GitLab token into the clone URL as oauth2 credentials.
   *
   * Security: validates that the URL hostname matches the configured GitLab
   * instance before injecting the token.  If a webhook payload supplies a URL
   * pointing at a different host, we throw rather than exfiltrate the token.
   */
  private injectToken(projectUrl: string): string {
    const url = new URL(projectUrl);
    const expected = new URL(config.GITLAB_URL);

    if (url.hostname !== expected.hostname) {
      throw new Error(`Refusing to clone from unexpected host: ${url.hostname} (expected: ${expected.hostname})`);
    }

    url.username = "oauth2";
    url.password = config.GITLAB_TOKEN;
    return url.toString();
  }

  /**
   * Spawn a command using `Bun.spawn()` and return its stdout as a string.
   * Throws a descriptive error if the command exits with a non-zero code.
   * When GITLAB_CA_FILE is configured, GIT_SSL_CAINFO is injected into the
   * subprocess env so git uses the custom CA bundle for HTTPS operations.
   */
  private async run(cmd: string[], cwd?: string): Promise<string> {
    const extraEnv = buildGitEnv(config.GITLAB_CA_FILE);
    const proc = Bun.spawn(cmd, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`git command failed (exit ${exitCode}): ${stderr.trim()}`);
    }

    return new Response(proc.stdout).text();
  }
}

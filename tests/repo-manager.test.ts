import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../src/config";
import { RepoManager } from "../src/context/repo-manager";

// ---------------------------------------------------------------------------
// All integration tests use config.REPO_CACHE_DIR, which is pointed at the
// test-specific directory /tmp/git-gandalf-test-cache via .env.test.
// This ensures tests never touch the real /tmp/repo_cache used in production.
// ---------------------------------------------------------------------------

const CACHE_DIR = config.REPO_CACHE_DIR;

beforeAll(async () => {
  await mkdir(CACHE_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(CACHE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getRepoPath
// ---------------------------------------------------------------------------

describe("RepoManager.getRepoPath", () => {
  it("returns a path directly under REPO_CACHE_DIR using projectId and branch", () => {
    const manager = new RepoManager();
    expect(manager.getRepoPath(42, "main")).toBe(join(CACHE_DIR, "42-main"));
  });

  it("stringifies the projectId", () => {
    const manager = new RepoManager();
    expect(manager.getRepoPath(1001, "main")).toBe(join(CACHE_DIR, "1001-main"));
  });

  it("uses distinct cache paths for different branches in the same project", () => {
    const manager = new RepoManager();
    expect(manager.getRepoPath(42, "main")).not.toBe(manager.getRepoPath(42, "feature/fix-review"));
  });

  it("escapes branch names so slashes stay within a single cache directory", () => {
    const manager = new RepoManager();
    expect(manager.getRepoPath(42, "feature/fix-review")).toBe(join(CACHE_DIR, "42-feature%2Ffix-review"));
  });
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

describe("RepoManager.cleanup", () => {
  it("removes entries whose mtime is older than maxAgeSec", async () => {
    const staleDir = join(CACHE_DIR, "stale-entry");
    await mkdir(staleDir, { recursive: true });

    // Wind the mtime back 2 hours so it is definitely beyond the 1-hour TTL.
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    await utimes(staleDir, twoHoursAgo, twoHoursAgo);

    const manager = new RepoManager();
    await manager.cleanup(3600); // 1-hour TTL

    const stillExists = await stat(staleDir)
      .then(() => true)
      .catch(() => false);
    expect(stillExists).toBe(false);
  });

  it("preserves entries whose mtime is within maxAgeSec", async () => {
    const freshDir = join(CACHE_DIR, "fresh-entry");
    await mkdir(freshDir, { recursive: true });
    // mtime is now — well within the 1-hour TTL

    const manager = new RepoManager();
    await manager.cleanup(3600);

    const stillExists = await stat(freshDir)
      .then(() => true)
      .catch(() => false);
    expect(stillExists).toBe(true);

    await rm(freshDir, { recursive: true, force: true });
  });

  it("does not throw when REPO_CACHE_DIR does not exist", async () => {
    // Temporarily remove the cache dir so cleanup sees a missing directory.
    await rm(CACHE_DIR, { recursive: true, force: true });

    const manager = new RepoManager();
    await expect(manager.cleanup(3600)).resolves.toBeUndefined();

    // Restore for subsequent tests.
    await mkdir(CACHE_DIR, { recursive: true });
  });

  it("handles concurrent eviction gracefully (no throw on already-removed entry)", async () => {
    const dir = join(CACHE_DIR, "race-entry");
    await mkdir(dir, { recursive: true });
    const past = new Date(Date.now() - 2 * 3600 * 1000);
    await utimes(dir, past, past);

    // Remove the dir before cleanup runs — simulates a concurrent process
    // deleting the entry between readdir and the stat call inside cleanup.
    await rm(dir, { recursive: true, force: true });

    const manager = new RepoManager();
    // cleanup should silently skip the already-gone entry rather than throw.
    await expect(manager.cleanup(3600)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cloneOrUpdate — SSRF host validation
// (full clone tested in E2E; unit tests cover the security boundary)
// ---------------------------------------------------------------------------

describe("RepoManager.cloneOrUpdate SSRF guard", () => {
  it("throws when the project URL hostname does not match GITLAB_URL", async () => {
    const manager = new RepoManager();
    await expect(manager.cloneOrUpdate("https://evil.attacker.com/org/repo.git", "main", 1)).rejects.toThrow(
      "Refusing to clone from unexpected host",
    );
  });

  it("includes the offending hostname in the error message", async () => {
    const manager = new RepoManager();
    await expect(manager.cloneOrUpdate("https://evil.attacker.com/org/repo.git", "main", 1)).rejects.toThrow(
      "evil.attacker.com",
    );
  });

  it("includes the expected hostname in the error message", async () => {
    const manager = new RepoManager();
    const expected = new URL(config.GITLAB_URL).hostname;
    await expect(manager.cloneOrUpdate("https://evil.attacker.com/org/repo.git", "main", 1)).rejects.toThrow(expected);
  });
});

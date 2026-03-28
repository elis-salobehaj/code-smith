import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_REPO_CONFIG,
  isValidRepoGlobPattern,
  matchesRepoConfigGlob,
  RepoConfigSchema,
} from "../src/config/repo-config";
import { loadRepoConfig } from "../src/config/repo-config-loader";

const tempRepos: string[] = [];

async function createTempRepo(): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "git-gandalf-repo-config-"));
  tempRepos.push(repoPath);
  return repoPath;
}

async function writeRepoConfig(repoPath: string, fileName: string, contents: string): Promise<void> {
  await Bun.write(join(repoPath, fileName), contents);
}

afterEach(async () => {
  await Promise.all(tempRepos.splice(0).map((repoPath) => rm(repoPath, { recursive: true, force: true })));
});

describe("RepoConfigSchema", () => {
  it("parses a full repo config", () => {
    const parsed = RepoConfigSchema.parse({
      version: 1,
      review_instructions: "Focus on error handling.",
      file_rules: [
        {
          pattern: "src/api/**",
          instructions: "Verify auth and validation.",
          severity_threshold: "high",
        },
        {
          pattern: "dist/",
          skip: true,
        },
      ],
      exclude: ["vendor/**", "**/*.snap"],
      severity: {
        minimum: "medium",
        block_on: "critical",
      },
      features: {
        linter_integration: true,
        enhanced_summary: true,
        learning: true,
      },
      linters: {
        enabled: true,
        profile: "strict",
        severity_threshold: "high",
      },
      output: {
        max_findings: 4,
        include_walkthrough: "always",
        collapsible_details: false,
      },
    });

    expect(parsed.review_instructions).toBe("Focus on error handling.");
    expect(parsed.file_rules).toHaveLength(2);
    expect(parsed.file_rules[1]).toEqual({
      pattern: "dist/",
      skip: true,
    });
    expect(parsed.exclude).toEqual(["vendor/**", "**/*.snap"]);
    expect(parsed.severity).toEqual({ minimum: "medium", block_on: "critical" });
    expect(parsed.features).toEqual({
      linter_integration: true,
      enhanced_summary: true,
      learning: true,
    });
    expect(parsed.linters).toEqual({
      enabled: true,
      profile: "strict",
      severity_threshold: "high",
    });
    expect(parsed.output).toEqual({
      max_findings: 4,
      include_walkthrough: "always",
      collapsible_details: false,
    });
  });

  it("applies defaults for a minimal config", () => {
    const parsed = RepoConfigSchema.parse({ version: 1 });

    expect(parsed).toEqual(DEFAULT_REPO_CONFIG);
  });

  it("applies nested defaults for partial configs", () => {
    const parsed = RepoConfigSchema.parse({
      version: 1,
      severity: {
        minimum: "medium",
      },
      features: {
        learning: true,
      },
      linters: {
        enabled: true,
      },
      output: {
        include_walkthrough: "always",
      },
    });

    expect(parsed.severity).toEqual({
      minimum: "medium",
      block_on: "high",
    });
    expect(parsed.features).toEqual({
      linter_integration: false,
      enhanced_summary: false,
      learning: true,
    });
    expect(parsed.linters).toEqual({
      enabled: true,
      profile: undefined,
      severity_threshold: "medium",
    });
    expect(parsed.output).toEqual({
      max_findings: 6,
      include_walkthrough: "always",
      collapsible_details: true,
    });
  });

  it("rejects unknown keys", () => {
    const result = RepoConfigSchema.safeParse({
      version: 1,
      unexpected: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects repo-defined executable command fields", () => {
    const result = RepoConfigSchema.safeParse({
      version: 1,
      linters: {
        enabled: true,
        profile: "default",
        command: "bunx biome check",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) => issue.path.join(".") === "linters" || issue.path.join(".") === "linters.command",
        ),
      ).toBe(true);
    }
  });

  it("rejects invalid glob syntax", () => {
    const result = RepoConfigSchema.safeParse({
      version: 1,
      exclude: ["src/**/("],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["exclude", 0]);
      expect(result.error.issues[0]?.message).toContain("Invalid glob pattern");
    }
  });
});

describe("loadRepoConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const repoPath = await createTempRepo();

    await expect(loadRepoConfig(repoPath)).resolves.toEqual(DEFAULT_REPO_CONFIG);
  });

  it("loads .gitgandalf.yaml when present", async () => {
    const repoPath = await createTempRepo();
    await writeRepoConfig(
      repoPath,
      ".gitgandalf.yaml",
      ["version: 1", "review_instructions: Keep summaries crisp.", "exclude:", "  - dist/"].join("\n"),
    );

    const config = await loadRepoConfig(repoPath);
    expect(config.review_instructions).toBe("Keep summaries crisp.");
    expect(config.exclude).toEqual(["dist/"]);
  });

  it("loads .gitgandalf.yml when .yaml is absent", async () => {
    const repoPath = await createTempRepo();
    await writeRepoConfig(repoPath, ".gitgandalf.yml", "version: 1\nexclude:\n  - vendor/**\n");

    const config = await loadRepoConfig(repoPath);
    expect(config.exclude).toEqual(["vendor/**"]);
  });

  it("prefers .gitgandalf.yaml over .gitgandalf.yml", async () => {
    const repoPath = await createTempRepo();
    await writeRepoConfig(repoPath, ".gitgandalf.yml", "version: 1\nreview_instructions: from yml\n");
    await writeRepoConfig(repoPath, ".gitgandalf.yaml", "version: 1\nreview_instructions: from yaml\n");

    const config = await loadRepoConfig(repoPath);
    expect(config.review_instructions).toBe("from yaml");
  });

  it("falls back to defaults for malformed YAML", async () => {
    const repoPath = await createTempRepo();
    await writeRepoConfig(repoPath, ".gitgandalf.yaml", "version: [1\n");

    await expect(loadRepoConfig(repoPath)).resolves.toEqual(DEFAULT_REPO_CONFIG);
  });

  it("falls back to defaults for invalid schema values", async () => {
    const repoPath = await createTempRepo();
    await writeRepoConfig(repoPath, ".gitgandalf.yaml", "version: 1\nseverity:\n  minimum: banana\n");

    await expect(loadRepoConfig(repoPath)).resolves.toEqual(DEFAULT_REPO_CONFIG);
  });

  it("falls back to defaults when unknown keys are present", async () => {
    const repoPath = await createTempRepo();
    await writeRepoConfig(repoPath, ".gitgandalf.yaml", "version: 1\nunknown_key: true\n");

    await expect(loadRepoConfig(repoPath)).resolves.toEqual(DEFAULT_REPO_CONFIG);
  });
});

describe("repo config glob compatibility", () => {
  it("accepts the planned glob compatibility matrix", () => {
    for (const pattern of [
      "**/*.ts",
      "!**/*.test.ts",
      "src/{api,agents}/**",
      ".hidden/**",
      "**/file.{js,ts}",
      "dir/",
    ]) {
      expect(isValidRepoGlobPattern(pattern)).toBe(true);
    }
  });

  it("matches recursive patterns", () => {
    expect(matchesRepoConfigGlob("**/*.ts", "src/index.ts")).toBe(true);
    expect(matchesRepoConfigGlob("**/*.ts", "index.js")).toBe(false);
  });

  it("matches negated patterns", () => {
    expect(matchesRepoConfigGlob("!**/*.test.ts", "src/foo.ts")).toBe(true);
    expect(matchesRepoConfigGlob("!**/*.test.ts", "src/foo.test.ts")).toBe(false);
  });

  it("matches brace expansion for directories", () => {
    expect(matchesRepoConfigGlob("src/{api,agents}/**", "src/api/pipeline.ts")).toBe(true);
    expect(matchesRepoConfigGlob("src/{api,agents}/**", "src/agents/state.ts")).toBe(true);
    expect(matchesRepoConfigGlob("src/{api,agents}/**", "src/context/repo-manager.ts")).toBe(false);
  });

  it("matches dot-prefixed paths", () => {
    expect(matchesRepoConfigGlob(".hidden/**", ".hidden/file.ts")).toBe(true);
    expect(matchesRepoConfigGlob(".hidden/**", "hidden/file.ts")).toBe(false);
  });

  it("matches brace expansion in filenames", () => {
    expect(matchesRepoConfigGlob("**/file.{js,ts}", "src/file.ts")).toBe(true);
    expect(matchesRepoConfigGlob("**/file.{js,ts}", "src/file.js")).toBe(true);
    expect(matchesRepoConfigGlob("**/file.{js,ts}", "src/file.jsx")).toBe(false);
  });

  it("matches trailing-slash directory rules via fallback handling", () => {
    expect(matchesRepoConfigGlob("dir/", "dir/file.ts")).toBe(true);
    expect(matchesRepoConfigGlob("dir/", "otherdir/file.ts")).toBe(false);
  });
});

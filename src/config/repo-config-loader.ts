import { join } from "node:path";
import type { ZodError } from "zod";
import { getLogger } from "../logger";
import { DEFAULT_REPO_CONFIG, REPO_CONFIG_FILENAMES, type RepoConfig, RepoConfigSchema } from "./repo-config";

const logger = getLogger(["gandalf", "repo-config"]);

function cloneDefaultRepoConfig(): RepoConfig {
  return structuredClone(DEFAULT_REPO_CONFIG);
}

function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

export async function loadRepoConfig(repoPath: string): Promise<RepoConfig> {
  for (const fileName of REPO_CONFIG_FILENAMES) {
    const filePath = join(repoPath, fileName);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      continue;
    }

    try {
      const rawConfig = Bun.YAML.parse(await file.text());
      const parsed = RepoConfigSchema.safeParse(rawConfig);

      if (!parsed.success) {
        logger.warn("Repo review config failed validation; using defaults", {
          repoPath,
          configPath: filePath,
          issues: formatZodIssues(parsed.error),
        });
        return cloneDefaultRepoConfig();
      }

      logger.info("Loaded repo review config", {
        repoPath,
        configPath: filePath,
      });
      return parsed.data;
    } catch (error) {
      logger.warn("Repo review config could not be parsed; using defaults", {
        repoPath,
        configPath: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return cloneDefaultRepoConfig();
    }
  }

  logger.info("No repo review config found; using defaults", {
    repoPath,
  });
  return cloneDefaultRepoConfig();
}

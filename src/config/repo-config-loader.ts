import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ZodError } from "zod";
import { config } from "../config";
import { getLogger } from "../logger";
import { DEFAULT_REPO_CONFIG, REPO_CONFIG_FILENAMES, type RepoConfig, RepoConfigSchema } from "./repo-config";
import {
  evaluateRepoConfigSecurity,
  formatRepoConfigSecurityIssue,
  getRepoConfigByteCount,
} from "./repo-config-security";

const logger = getLogger(["codesmith", "repo-config"]);

export type RepoConfigLoadStatus = "not_found" | "loaded" | "byte_cap_exceeded" | "invalid" | "parse_error";

export interface RepoConfigLoadResult {
  status: RepoConfigLoadStatus;
  fileName: string | null;
  present: boolean;
  byteCount: number | null;
  hash: string | null;
  parsedConfig: RepoConfig | null;
  validationIssues: string[];
}

function cloneDefaultRepoConfig(): RepoConfig {
  return structuredClone(DEFAULT_REPO_CONFIG);
}

function hashRepoConfigText(rawText: string): string {
  return createHash("sha256").update(rawText).digest("hex");
}

function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

export function parseRepoConfigText(fileName: string, rawText: string): RepoConfigLoadResult {
  const byteCount = getRepoConfigByteCount(rawText);
  const hash = hashRepoConfigText(rawText);

  if (byteCount > config.SECURITY_GATE_MAX_CONFIG_BYTES) {
    return {
      status: "byte_cap_exceeded",
      fileName,
      present: true,
      byteCount,
      hash,
      parsedConfig: null,
      validationIssues: [],
    };
  }

  try {
    const rawConfig = Bun.YAML.parse(rawText);
    const parsed = RepoConfigSchema.safeParse(rawConfig);

    if (!parsed.success) {
      return {
        status: "invalid",
        fileName,
        present: true,
        byteCount,
        hash,
        parsedConfig: null,
        validationIssues: formatZodIssues(parsed.error),
      };
    }

    return {
      status: "loaded",
      fileName,
      present: true,
      byteCount,
      hash,
      parsedConfig: parsed.data,
      validationIssues: [],
    };
  } catch (error) {
    return {
      status: "parse_error",
      fileName,
      present: true,
      byteCount,
      hash,
      parsedConfig: null,
      validationIssues: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function readRepoConfigFromRepoPath(repoPath: string): Promise<RepoConfigLoadResult> {
  for (const fileName of REPO_CONFIG_FILENAMES) {
    const filePath = join(repoPath, fileName);
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      continue;
    }

    return parseRepoConfigText(fileName, await file.text());
  }

  return {
    status: "not_found",
    fileName: null,
    present: false,
    byteCount: null,
    hash: null,
    parsedConfig: null,
    validationIssues: [],
  };
}

export async function loadRepoConfig(repoPath: string): Promise<RepoConfig> {
  const loaded = await readRepoConfigFromRepoPath(repoPath);

  if (loaded.status === "not_found") {
    logger.info("No repo review config found; using defaults", {
      repoPath,
    });
    return cloneDefaultRepoConfig();
  }

  const configPath = join(repoPath, loaded.fileName ?? "<unknown>");

  if (loaded.status === "byte_cap_exceeded") {
    logger.warn("Repo review config exceeded byte cap; using defaults", {
      repoPath,
      configPath,
      byteCount: loaded.byteCount,
      maxBytes: config.SECURITY_GATE_MAX_CONFIG_BYTES,
    });
    return cloneDefaultRepoConfig();
  }

  if (loaded.status === "invalid") {
    logger.warn("Repo review config failed validation; using defaults", {
      repoPath,
      configPath,
      issues: loaded.validationIssues,
    });
    return cloneDefaultRepoConfig();
  }

  if (loaded.status === "parse_error") {
    logger.warn("Repo review config could not be parsed; using defaults", {
      repoPath,
      configPath,
      error: loaded.validationIssues[0] ?? "unknown parse error",
    });
    return cloneDefaultRepoConfig();
  }

  if (!loaded.parsedConfig) {
    logger.warn("Repo review config resolved without a parsed payload; using defaults", {
      repoPath,
      configPath,
      status: loaded.status,
    });
    return cloneDefaultRepoConfig();
  }

  const screened = evaluateRepoConfigSecurity(loaded.parsedConfig);

  if (screened.issues.length > 0) {
    logger.warn("Repo review config contained unsafe fields; using sanitized config", {
      repoPath,
      configPath,
      issueCount: screened.issues.length,
      issues: screened.issues.map(formatRepoConfigSecurityIssue),
    });
  }

  logger.info("Loaded repo review config", {
    repoPath,
    configPath,
  });
  return screened.sanitizedConfig;
}

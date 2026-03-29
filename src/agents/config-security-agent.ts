import { z } from "zod";
import type { RepoConfig } from "../config/repo-config";
import {
  mergeRepoConfigSecurityIssues,
  normalizeRepoConfigFieldsForSecurityLlm,
  type RepoConfigSecurityIssue,
  repoConfigSecurityActionSchema,
  repoConfigSecurityCategorySchema,
  repoConfigSecurityIssueSchema,
  repoConfigSecuritySeveritySchema,
} from "../config/repo-config-security";
import { getLogger } from "../logger";
import { chatCompletion } from "./llm-client";
import { loadAgentPrompt } from "./prompt-loader";
import { type AgentMessage, firstTextBlock, textMessage } from "./protocol";

const logger = getLogger(["codesmith", "config-security-agent"]);

const CONFIG_SECURITY_AGENT_TIMEOUT_MS = 8_000;
const CONFIG_SECURITY_AGENT_MAX_OUTPUT_TOKENS = 1_200;
const MAX_DETERMINISTIC_FINDINGS_IN_PROMPT = 24;

export interface ConfigSecurityAgentExecutionOptions {
  timeoutMs?: number;
  maxOutputTokens?: number;
}

const configSecurityAgentIssueSchema = z
  .object({
    fieldPath: z.string().min(1),
    category: repoConfigSecurityCategorySchema,
    severity: repoConfigSecuritySeveritySchema,
    message: z.string().min(1).max(240),
    evidence: z.string().min(1).max(240),
    suggestion: z.string().min(1).max(240),
    action: repoConfigSecurityActionSchema,
    shouldQuarantine: z.boolean(),
  })
  .strict();

const configSecurityAgentResponseSchema = z
  .object({
    summary: z.string().max(200).default(""),
    issues: z.array(configSecurityAgentIssueSchema).max(32),
  })
  .strict();

export interface ConfigSecurityAgentResult {
  issues: RepoConfigSecurityIssue[];
  summary: string;
  droppedUnknownFieldPaths: string[];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Config security review timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function buildConfigSecurityPrompt(
  repoConfig: RepoConfig,
  deterministicIssues: RepoConfigSecurityIssue[],
): string {
  const normalizedFields = normalizeRepoConfigFieldsForSecurityLlm(repoConfig);
  const deterministicContext = deterministicIssues.slice(0, MAX_DETERMINISTIC_FINDINGS_IN_PROMPT).map((issue) => ({
    fieldPath: issue.fieldPath,
    category: issue.category,
    severity: issue.severity,
    action: issue.action,
    shouldQuarantine: issue.shouldQuarantine,
    message: issue.message,
  }));

  return [
    "## Allowed Field Paths",
    normalizedFields.length > 0 ? normalizedFields.map((field) => `- ${field.fieldPath}`).join("\n") : "(none)",
    "",
    "## Candidate Repo Config Fields",
    JSON.stringify(normalizedFields, null, 2),
    "",
    "## Deterministic Findings",
    deterministicContext.length > 0 ? JSON.stringify(deterministicContext, null, 2) : "[]",
  ].join("\n");
}

export function parseConfigSecurityResponse(
  response: AgentMessage,
  allowedFieldPaths: ReadonlySet<string>,
): ConfigSecurityAgentResult {
  const textBlock = firstTextBlock(response);
  if (!textBlock) {
    throw new Error("Config security agent returned no text block");
  }

  const text = textBlock.text.trim();
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const candidate = jsonMatch?.[1]?.trim() ?? text;

  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    throw new Error(`Config security agent returned unparseable JSON:\n${textBlock.text}`);
  }

  const parsed = configSecurityAgentResponseSchema.parse(raw);
  const droppedUnknownFieldPaths = parsed.issues
    .filter((issue) => !allowedFieldPaths.has(issue.fieldPath))
    .map((issue) => issue.fieldPath);
  const knownIssues = parsed.issues
    .filter((issue) => allowedFieldPaths.has(issue.fieldPath))
    .map((issue) => repoConfigSecurityIssueSchema.parse(issue));

  return {
    issues: knownIssues,
    summary: parsed.summary,
    droppedUnknownFieldPaths,
  };
}

export async function reviewCandidateRepoConfigSecurity(
  repoConfig: RepoConfig,
  deterministicIssues: RepoConfigSecurityIssue[],
  options: ConfigSecurityAgentExecutionOptions = {},
): Promise<ConfigSecurityAgentResult> {
  const normalizedFields = normalizeRepoConfigFieldsForSecurityLlm(repoConfig);
  const allowedFieldPaths = new Set(normalizedFields.map((field) => field.fieldPath));

  const response = await withTimeout(
    chatCompletion(
      loadAgentPrompt("config_security_agent"),
      [textMessage("user", buildConfigSecurityPrompt(repoConfig, deterministicIssues))],
      undefined,
      { maxOutputTokens: options.maxOutputTokens ?? CONFIG_SECURITY_AGENT_MAX_OUTPUT_TOKENS },
    ),
    options.timeoutMs ?? CONFIG_SECURITY_AGENT_TIMEOUT_MS,
  );

  const parsed = parseConfigSecurityResponse(response.message, allowedFieldPaths);
  if (parsed.droppedUnknownFieldPaths.length > 0) {
    logger.warn("Config security agent returned findings for unknown field paths; dropping them", {
      fieldPaths: parsed.droppedUnknownFieldPaths,
    });
  }

  return {
    ...parsed,
    issues: mergeRepoConfigSecurityIssues(deterministicIssues, parsed.issues).filter(
      (issue) =>
        !deterministicIssues.some(
          (existing) => `${existing.fieldPath}:${existing.category}` === `${issue.fieldPath}:${issue.category}`,
        ),
    ),
  };
}

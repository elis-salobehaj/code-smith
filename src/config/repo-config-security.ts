import { z } from "zod";
import { DEFAULT_REPO_CONFIG, type RepoConfig, RepoConfigSchema } from "./repo-config";

export const DEFAULT_SECURITY_GATE_MAX_CONFIG_BYTES = 16 * 1024;

const EVIDENCE_MAX_CHARS = 120;
const BASE64_LIKE_MIN_CHARS = 80;
const REPEATED_DELIMITER_MIN_CHARS = 12;

const BROAD_SUPPRESSION_PATTERNS = new Set(["*", "**", "**/*", "**/**", "*/**", "**/*.*"]);
const SAFE_SUPPRESSION_ROOTS = new Set([
  "dist",
  "build",
  "coverage",
  "vendor",
  "node_modules",
  "generated",
  "logs",
  "log",
  "tmp",
  "temp",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
]);
const SOURCE_TREE_ROOTS = new Set(["src", "app", "lib", "packages", "pkg", "services", "service", "server", "client"]);

export const repoConfigSecurityFieldClassSchema = z.enum(["sealed", "prompt_bearing", "scope_shaping", "selector"]);
export const repoConfigSecuritySeveritySchema = z.enum(["low", "medium", "high"]);
export const repoConfigSecurityActionSchema = z.enum(["keep", "remove_field", "remove_entry", "replace_with_defaults"]);
export const repoConfigSecurityCategorySchema = z.enum([
  "instruction_override",
  "outcome_manipulation",
  "tool_steering",
  "prompt_structure",
  "encoded_payload",
  "scope_suppression",
  "selector_abuse",
  "markdown_marker_abuse",
  "oversize_input",
  "suspicious_content",
]);

export const repoConfigSecurityFieldSchema = z
  .object({
    fieldPath: z.string().min(1),
    fieldClass: repoConfigSecurityFieldClassSchema,
    value: z.string().min(1),
  })
  .strict();

export const repoConfigSecurityIssueSchema = z
  .object({
    fieldPath: z.string().min(1),
    category: repoConfigSecurityCategorySchema,
    severity: repoConfigSecuritySeveritySchema,
    message: z.string().min(1),
    evidence: z.string().min(1),
    suggestion: z.string().min(1),
    action: repoConfigSecurityActionSchema,
    shouldQuarantine: z.boolean(),
  })
  .strict();

export const repoConfigSecurityResultSchema = z
  .object({
    issues: z.array(repoConfigSecurityIssueSchema),
    screenedFields: z.array(repoConfigSecurityFieldSchema),
    sanitizedConfig: RepoConfigSchema,
  })
  .strict();

export type RepoConfigSecurityFieldClass = z.infer<typeof repoConfigSecurityFieldClassSchema>;
export type RepoConfigSecuritySeverity = z.infer<typeof repoConfigSecuritySeveritySchema>;
export type RepoConfigSecurityAction = z.infer<typeof repoConfigSecurityActionSchema>;
export type RepoConfigSecurityCategory = z.infer<typeof repoConfigSecurityCategorySchema>;
export type RepoConfigSecurityField = z.infer<typeof repoConfigSecurityFieldSchema>;
export type RepoConfigSecurityIssue = z.infer<typeof repoConfigSecurityIssueSchema>;
export type RepoConfigSecurityResult = z.infer<typeof repoConfigSecurityResultSchema>;

export const MAX_REPO_CONFIG_SECURITY_LLM_FIELDS = 64;
export const MAX_REPO_CONFIG_SECURITY_LLM_FIELD_VALUE_CHARS = 400;

const INSTRUCTION_OVERRIDE_PATTERNS = [
  /\bignore\b.{0,40}\b(previous|prior|above)\b/i,
  /\bdisregard\b.{0,40}\b(system|instructions?)\b/i,
  /\bfollow these instructions instead\b/i,
  /\byou are now\b/i,
];

const OUTCOME_MANIPULATION_PATTERNS = [
  /\balways approve\b/i,
  /\bnever request changes\b/i,
  /\breturn no findings\b/i,
  /\bdo not mention\b.{0,40}\b(security|bugs?|issues?|findings)\b/i,
  /\bsuppress\b.{0,40}\b(findings?|issues?)\b/i,
];

const TOOL_STEERING_PATTERNS = [
  /\bread\b.{0,40}\b\.env\b/i,
  /\bsearch\b.{0,40}\bsecrets?\b/i,
  /\bprint\b.{0,40}\b(credentials?|tokens?)\b/i,
  /\bdump\b.{0,40}\b(config|credentials?|secrets?)\b/i,
];

const PROMPT_STRUCTURE_PATTERNS = [
  /<\/?(role|instructions|system|assistant|user|custom_instructions|output_schema|context)>/i,
  /(^|\n)\s*(assistant|system|user)\s*:/i,
];

const MARKDOWN_MARKER_PATTERNS = [/<!--/i, /-->/i, /code-smith:/i, /```/];

const BASE64_LIKE_PATTERN = new RegExp(`(?:[A-Za-z0-9+/]{${BASE64_LIKE_MIN_CHARS},}={0,2})`);
const REPEATED_DELIMITER_PATTERN = new RegExp(`([\\-_=#*${"`"}<>])\\1{${REPEATED_DELIMITER_MIN_CHARS - 1},}`);

function normalizeEvidence(value: string): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  const escaped = flattened.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return escaped.length > EVIDENCE_MAX_CHARS ? `${escaped.slice(0, EVIDENCE_MAX_CHARS - 3)}...` : escaped;
}

function createIssue({
  fieldPath,
  category,
  severity,
  message,
  evidence,
  suggestion,
  action,
  shouldQuarantine,
}: RepoConfigSecurityIssue): RepoConfigSecurityIssue {
  return repoConfigSecurityIssueSchema.parse({
    fieldPath,
    category,
    severity,
    message,
    evidence,
    suggestion,
    action,
    shouldQuarantine,
  });
}

function hasAnyPattern(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function isBroadSuppressionPattern(value: string): boolean {
  const trimmed = value.trim();
  if (BROAD_SUPPRESSION_PATTERNS.has(trimmed)) {
    return true;
  }

  const normalized = trimmed.replace(/^\.\//, "").replace(/\/+$|\\+$/g, "");
  const pathSegments = normalized.split("/").filter(Boolean);
  if (pathSegments.length >= 2) {
    const root = pathSegments[0];
    const remainder = pathSegments.slice(1).join("/");
    const remainderContainsWildcard = /[*?[{]/.test(remainder);
    const remainderIsBroad =
      remainder === "**" ||
      remainder === "**/*" ||
      remainder.startsWith("**/") ||
      remainder === "*" ||
      /^\*\.[A-Za-z0-9*?{}[\],-]+$/.test(remainder);

    if (
      root &&
      SOURCE_TREE_ROOTS.has(root) &&
      !SAFE_SUPPRESSION_ROOTS.has(root) &&
      remainderContainsWildcard &&
      remainderIsBroad
    ) {
      return true;
    }
  }

  const literalSegments = trimmed.match(/[A-Za-z0-9_.-]+/g) ?? [];
  return literalSegments.length === 0;
}

function isSuspiciousPayloadShape(value: string): boolean {
  return BASE64_LIKE_PATTERN.test(value) || REPEATED_DELIMITER_PATTERN.test(value);
}

function scanField(field: RepoConfigSecurityField): RepoConfigSecurityIssue[] {
  const issues: RepoConfigSecurityIssue[] = [];
  const value = field.value.trim();

  if (field.fieldClass === "selector") {
    issues.push(
      createIssue({
        fieldPath: field.fieldPath,
        category: "selector_abuse",
        severity: "high",
        message: "Open-ended execution selectors stay quarantined until a deployment-owned allowlist exists.",
        evidence: normalizeEvidence(field.value),
        suggestion: "Remove this selector for now, or wait until a future allowlisted profile registry is implemented.",
        action: "remove_field",
        shouldQuarantine: true,
      }),
    );
  }

  if (hasAnyPattern(INSTRUCTION_OVERRIDE_PATTERNS, value)) {
    issues.push(
      createIssue({
        fieldPath: field.fieldPath,
        category: "instruction_override",
        severity: "high",
        message: "This field attempts to override higher-priority reviewer instructions.",
        evidence: normalizeEvidence(field.value),
        suggestion:
          "Rewrite the guidance as repository-specific review context without telling the reviewer to ignore prior instructions.",
        action: field.fieldClass === "scope_shaping" ? "remove_entry" : "remove_field",
        shouldQuarantine: true,
      }),
    );
  }

  if (hasAnyPattern(OUTCOME_MANIPULATION_PATTERNS, value)) {
    issues.push(
      createIssue({
        fieldPath: field.fieldPath,
        category: "outcome_manipulation",
        severity: "high",
        message: "This field attempts to manipulate the outcome of the review.",
        evidence: normalizeEvidence(field.value),
        suggestion:
          "Describe the repository's correctness expectations instead of telling the reviewer what result to produce.",
        action: field.fieldClass === "scope_shaping" ? "remove_entry" : "remove_field",
        shouldQuarantine: true,
      }),
    );
  }

  if (hasAnyPattern(TOOL_STEERING_PATTERNS, value)) {
    issues.push(
      createIssue({
        fieldPath: field.fieldPath,
        category: "tool_steering",
        severity: "high",
        message: "This field attempts to steer repository or secret inspection rather than define review policy.",
        evidence: normalizeEvidence(field.value),
        suggestion: "Remove instructions that direct secret searches or unrelated file inspection.",
        action: field.fieldClass === "scope_shaping" ? "remove_entry" : "remove_field",
        shouldQuarantine: true,
      }),
    );
  }

  if (hasAnyPattern(PROMPT_STRUCTURE_PATTERNS, value)) {
    issues.push(
      createIssue({
        fieldPath: field.fieldPath,
        category: "prompt_structure",
        severity: "high",
        message: "This field contains prompt-structure or role-tag content that can break prompt framing.",
        evidence: normalizeEvidence(field.value),
        suggestion: "Use plain natural-language guidance without XML-like tags or role prefixes.",
        action: field.fieldClass === "scope_shaping" ? "remove_entry" : "remove_field",
        shouldQuarantine: true,
      }),
    );
  }

  if (hasAnyPattern(MARKDOWN_MARKER_PATTERNS, value)) {
    issues.push(
      createIssue({
        fieldPath: field.fieldPath,
        category: "markdown_marker_abuse",
        severity: "high",
        message: "This field contains markup or hidden-marker content that can break publication surfaces.",
        evidence: normalizeEvidence(field.value),
        suggestion: "Remove HTML comments, hidden markers, and fenced blocks from repo-owned config guidance.",
        action: field.fieldClass === "scope_shaping" ? "remove_entry" : "remove_field",
        shouldQuarantine: true,
      }),
    );
  }

  if (isSuspiciousPayloadShape(value)) {
    issues.push(
      createIssue({
        fieldPath: field.fieldPath,
        category: "encoded_payload",
        severity: "high",
        message:
          "This field contains an encoded or delimiter-heavy payload shape that is not appropriate for repo review policy.",
        evidence: normalizeEvidence(field.value),
        suggestion: "Remove opaque encoded content and keep config values short, literal, and review-specific.",
        action: field.fieldClass === "scope_shaping" ? "remove_entry" : "remove_field",
        shouldQuarantine: true,
      }),
    );
  }

  if (field.fieldClass === "scope_shaping" && isBroadSuppressionPattern(value)) {
    issues.push(
      createIssue({
        fieldPath: field.fieldPath,
        category: "scope_suppression",
        severity: "high",
        message: "This pattern is broad enough to suppress large portions of the repository if later trusted.",
        evidence: normalizeEvidence(field.value),
        suggestion: "Use a narrower repo-relative pattern that targets only generated or intentionally excluded paths.",
        action: "remove_entry",
        shouldQuarantine: true,
      }),
    );
  }

  if (
    issues.length === 0 &&
    field.fieldClass === "prompt_bearing" &&
    value.length >= Math.floor(EVIDENCE_MAX_CHARS * 0.8)
  ) {
    issues.push(
      createIssue({
        fieldPath: field.fieldPath,
        category: "suspicious_content",
        severity: "low",
        message: "This field is unusually long for repo-owned review guidance and may need manual review.",
        evidence: normalizeEvidence(field.value),
        suggestion: "Keep repo-owned guidance short, direct, and repository-specific.",
        action: "keep",
        shouldQuarantine: false,
      }),
    );
  }

  return issues;
}

function parseArrayIndex(fieldPath: string, prefix: "exclude" | "file_rules"): number | null {
  const match = new RegExp(`^${prefix}\\[(\\d+)\\]`).exec(fieldPath);
  return match ? Number(match[1]) : null;
}

export function getRepoConfigByteCount(rawText: string): number {
  return Buffer.byteLength(rawText, "utf8");
}

export function createRepoConfigOversizeIssue(
  byteCount: number,
  maxBytes = DEFAULT_SECURITY_GATE_MAX_CONFIG_BYTES,
): RepoConfigSecurityIssue {
  return createIssue({
    fieldPath: "<root>",
    category: "oversize_input",
    severity: "high",
    message: "Repo review config exceeded the maximum allowed size before YAML parse.",
    evidence: normalizeEvidence(`config size ${byteCount} bytes exceeds limit ${maxBytes} bytes`),
    suggestion: "Reduce the repo config size so it stays within the configured byte budget.",
    action: "replace_with_defaults",
    shouldQuarantine: true,
  });
}

export function formatRepoConfigSecurityIssue(issue: RepoConfigSecurityIssue): string {
  return `${issue.fieldPath} [${issue.category}] ${issue.message}`;
}

export function classifyRepoConfigField(fieldPath: string): RepoConfigSecurityFieldClass {
  if (fieldPath === "review_instructions" || /^file_rules\[\d+\]\.instructions$/.test(fieldPath)) {
    return "prompt_bearing";
  }

  if (fieldPath === "linters.profile") {
    return "selector";
  }

  if (/^exclude\[\d+\]$/.test(fieldPath) || /^file_rules\[\d+\]\.pattern$/.test(fieldPath)) {
    return "scope_shaping";
  }

  return "sealed";
}

export function buildRepoConfigFieldInventory(repoConfig: RepoConfig): RepoConfigSecurityField[] {
  const fields: RepoConfigSecurityField[] = [];

  if (repoConfig.review_instructions) {
    fields.push(
      repoConfigSecurityFieldSchema.parse({
        fieldPath: "review_instructions",
        fieldClass: "prompt_bearing",
        value: repoConfig.review_instructions,
      }),
    );
  }

  repoConfig.exclude.forEach((pattern, index) => {
    fields.push(
      repoConfigSecurityFieldSchema.parse({
        fieldPath: `exclude[${index}]`,
        fieldClass: "scope_shaping",
        value: pattern,
      }),
    );
  });

  repoConfig.file_rules.forEach((rule, index) => {
    fields.push(
      repoConfigSecurityFieldSchema.parse({
        fieldPath: `file_rules[${index}].pattern`,
        fieldClass: "scope_shaping",
        value: rule.pattern,
      }),
    );

    if (rule.instructions) {
      fields.push(
        repoConfigSecurityFieldSchema.parse({
          fieldPath: `file_rules[${index}].instructions`,
          fieldClass: "prompt_bearing",
          value: rule.instructions,
        }),
      );
    }
  });

  if (repoConfig.linters.profile) {
    fields.push(
      repoConfigSecurityFieldSchema.parse({
        fieldPath: "linters.profile",
        fieldClass: "selector",
        value: repoConfig.linters.profile,
      }),
    );
  }

  return fields;
}

export function normalizeRepoConfigFieldsForSecurityLlm(repoConfig: RepoConfig): RepoConfigSecurityField[] {
  return buildRepoConfigFieldInventory(repoConfig)
    .slice(0, MAX_REPO_CONFIG_SECURITY_LLM_FIELDS)
    .map((field) =>
      repoConfigSecurityFieldSchema.parse({
        ...field,
        value:
          field.value.length > MAX_REPO_CONFIG_SECURITY_LLM_FIELD_VALUE_CHARS
            ? `${field.value.slice(0, MAX_REPO_CONFIG_SECURITY_LLM_FIELD_VALUE_CHARS - 3)}...`
            : field.value,
      }),
    );
}

export function sanitizeRepoConfig(repoConfig: RepoConfig, issues: RepoConfigSecurityIssue[]): RepoConfig {
  if (issues.some((issue) => issue.shouldQuarantine && issue.action === "replace_with_defaults")) {
    return structuredClone(DEFAULT_REPO_CONFIG);
  }

  const sanitized = structuredClone(repoConfig);
  const excludedIndexes = new Set<number>();
  const fileRuleIndexes = new Set<number>();

  for (const issue of issues) {
    if (!issue.shouldQuarantine) {
      continue;
    }

    if (issue.fieldPath === "review_instructions") {
      delete sanitized.review_instructions;
      continue;
    }

    if (issue.fieldPath === "linters.profile") {
      delete sanitized.linters.profile;
      continue;
    }

    const excludeIndex = parseArrayIndex(issue.fieldPath, "exclude");
    if (excludeIndex !== null) {
      excludedIndexes.add(excludeIndex);
      continue;
    }

    const fileRuleIndex = parseArrayIndex(issue.fieldPath, "file_rules");
    if (fileRuleIndex !== null) {
      if (/\.pattern$/.test(issue.fieldPath)) {
        fileRuleIndexes.add(fileRuleIndex);
      } else if (/\.instructions$/.test(issue.fieldPath)) {
        delete sanitized.file_rules[fileRuleIndex]?.instructions;
      }
    }
  }

  if (excludedIndexes.size > 0) {
    sanitized.exclude = sanitized.exclude.filter((_, index) => !excludedIndexes.has(index));
  }

  if (fileRuleIndexes.size > 0) {
    sanitized.file_rules = sanitized.file_rules.filter((_, index) => !fileRuleIndexes.has(index));
  }

  return RepoConfigSchema.parse(sanitized);
}

export function evaluateRepoConfigSecurity(repoConfig: RepoConfig): RepoConfigSecurityResult {
  const screenedFields = buildRepoConfigFieldInventory(repoConfig);
  const issueMap = new Map<string, RepoConfigSecurityIssue>();

  for (const field of screenedFields) {
    for (const issue of scanField(field)) {
      const key = `${issue.fieldPath}:${issue.category}`;
      if (!issueMap.has(key)) {
        issueMap.set(key, issue);
      }
    }
  }

  const issues = [...issueMap.values()];
  const sanitizedConfig = sanitizeRepoConfig(repoConfig, issues);

  return repoConfigSecurityResultSchema.parse({
    issues,
    screenedFields,
    sanitizedConfig,
  });
}

export function mergeRepoConfigSecurityIssues(
  primaryIssues: RepoConfigSecurityIssue[],
  secondaryIssues: RepoConfigSecurityIssue[],
): RepoConfigSecurityIssue[] {
  const mergedIssues = new Map<string, RepoConfigSecurityIssue>();

  for (const issue of primaryIssues) {
    mergedIssues.set(`${issue.fieldPath}:${issue.category}`, issue);
  }

  for (const issue of secondaryIssues) {
    const key = `${issue.fieldPath}:${issue.category}`;
    if (!mergedIssues.has(key)) {
      mergedIssues.set(key, issue);
    }
  }

  return [...mergedIssues.values()];
}

import picomatch from "picomatch";
import { z } from "zod";

export const REPO_CONFIG_FILENAMES = [".codesmith.yaml", ".codesmith.yml"] as const;

const severityLevelSchema = z.enum(["low", "medium", "high", "critical"]);

const DEFAULT_SEVERITY_CONFIG = {
  minimum: "low",
  block_on: "high",
} as const;

const DEFAULT_FEATURE_FLAGS = {
  linter_integration: false,
  enhanced_summary: false,
  learning: false,
} as const;

const DEFAULT_LINTER_CONFIG = {
  enabled: false,
  severity_threshold: "medium",
} as const;

const DEFAULT_OUTPUT_CONFIG = {
  max_findings: 6,
  include_walkthrough: "auto",
  collapsible_details: true,
} as const;

const PICOMATCH_OPTIONS = {
  dot: true,
  strictBrackets: true,
};

function normalizeRepoGlobPattern(pattern: string): string {
  return pattern.endsWith("/") ? `${pattern}**` : pattern;
}

function usesPicomatchFallback(pattern: string): boolean {
  return pattern.endsWith("/");
}

export function isValidRepoGlobPattern(pattern: string): boolean {
  try {
    picomatch.makeRe(normalizeRepoGlobPattern(pattern), PICOMATCH_OPTIONS);
    return true;
  } catch {
    return false;
  }
}

export function matchesRepoConfigGlob(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizeRepoGlobPattern(pattern);

  if (usesPicomatchFallback(pattern)) {
    return picomatch.isMatch(filePath, normalizedPattern, PICOMATCH_OPTIONS);
  }

  return new Bun.Glob(normalizedPattern).match(filePath);
}

const globPatternSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((pattern, ctx) => {
    if (!isValidRepoGlobPattern(pattern)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid glob pattern: ${pattern}`,
      });
    }
  });

const fileRuleSchema = z
  .object({
    pattern: globPatternSchema,
    severity_threshold: severityLevelSchema.optional(),
    instructions: z.string().trim().min(1).optional(),
    skip: z.boolean().optional(),
  })
  .strict();

const severityConfigSchema = z
  .object({
    minimum: severityLevelSchema.optional(),
    block_on: severityLevelSchema.optional(),
  })
  .strict()
  .default({})
  .transform((value) => ({
    minimum: value.minimum ?? DEFAULT_SEVERITY_CONFIG.minimum,
    block_on: value.block_on ?? DEFAULT_SEVERITY_CONFIG.block_on,
  }));

const featureFlagsSchema = z
  .object({
    linter_integration: z.boolean().optional(),
    enhanced_summary: z.boolean().optional(),
    learning: z.boolean().optional(),
  })
  .strict()
  .default({})
  .transform((value) => ({
    linter_integration: value.linter_integration ?? DEFAULT_FEATURE_FLAGS.linter_integration,
    enhanced_summary: value.enhanced_summary ?? DEFAULT_FEATURE_FLAGS.enhanced_summary,
    learning: value.learning ?? DEFAULT_FEATURE_FLAGS.learning,
  }));

const linterConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    profile: z.string().trim().min(1).optional(),
    severity_threshold: severityLevelSchema.optional(),
  })
  .strict()
  .default({})
  .transform((value) => ({
    enabled: value.enabled ?? DEFAULT_LINTER_CONFIG.enabled,
    profile: value.profile,
    severity_threshold: value.severity_threshold ?? DEFAULT_LINTER_CONFIG.severity_threshold,
  }));

const outputConfigSchema = z
  .object({
    max_findings: z.number().int().positive().optional(),
    include_walkthrough: z.enum(["auto", "always", "never"]).optional(),
    collapsible_details: z.boolean().optional(),
  })
  .strict()
  .default({})
  .transform((value) => ({
    max_findings: value.max_findings ?? DEFAULT_OUTPUT_CONFIG.max_findings,
    include_walkthrough: value.include_walkthrough ?? DEFAULT_OUTPUT_CONFIG.include_walkthrough,
    collapsible_details: value.collapsible_details ?? DEFAULT_OUTPUT_CONFIG.collapsible_details,
  }));

export const RepoConfigSchema = z
  .object({
    version: z.literal(1),
    review_instructions: z.string().trim().min(1).optional(),
    file_rules: z.array(fileRuleSchema).default([]),
    exclude: z.array(globPatternSchema).default([]),
    severity: severityConfigSchema,
    features: featureFlagsSchema,
    linters: linterConfigSchema,
    output: outputConfigSchema,
  })
  .strict();

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export const DEFAULT_REPO_CONFIG: RepoConfig = RepoConfigSchema.parse({
  version: 1,
});

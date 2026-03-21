import { z } from "zod";

const envSchema = z.object({
  GITLAB_URL: z.string().url(),
  GITLAB_TOKEN: z.string().min(1),
  GITLAB_WEBHOOK_SECRET: z.string().min(1),
  AWS_REGION: z.string().default("us-west-2"),
  AWS_BEARER_TOKEN_BEDROCK: z.string().min(1),
  AWS_AUTH_SCHEME_PREFERENCE: z.string().default("smithy.api#httpBearerAuth"),
  LLM_MODEL: z.string().default("global.anthropic.claude-sonnet-4-6"),
  MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(15),
  MAX_SEARCH_RESULTS: z.coerce.number().int().positive().default(100),
  REPO_CACHE_DIR: z.string().default("/tmp/repo_cache"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  PORT: z.coerce.number().int().positive().default(8020),

  // Jira read-only context enrichment (Phase 4.5)
  JIRA_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  JIRA_BASE_URL: z.string().url().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  // Comma-separated allow-list of Jira project keys (e.g. "ENG,PLATFORM").
  // When absent, all extracted keys are fetched.
  JIRA_PROJECT_KEYS: z.string().optional(),
  // Custom-field ID for acceptance criteria (e.g. "customfield_12345").
  JIRA_ACCEPTANCE_CRITERIA_FIELD_ID: z.string().optional(),
  // Max Jira tickets fetched per review run. Caps blast radius.
  JIRA_MAX_TICKETS: z.coerce.number().int().positive().default(5),
  // Per-ticket fetch timeout in milliseconds.
  JIRA_TICKET_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type Config = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);

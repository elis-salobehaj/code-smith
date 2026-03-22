import { z } from "zod";

const envSchema = z
  .object({
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

    // GitLab deployment hardening (Phase 4.6)
    // Path to a PEM-encoded CA bundle for self-hosted GitLab instances that use
    // a privately-signed certificate (internal / enterprise CA).
    // When set, GitGandalf injects this file into every git subprocess via
    // GIT_SSL_CAINFO and exposes it via NODE_EXTRA_CA_CERTS for the
    // @gitbeaker/rest HTTP client at startup.
    GITLAB_CA_FILE: z.string().optional(),

    // ---------------------------------------------------------------------------
    // Task queue (Phase 5.1 — BullMQ + Valkey)
    // ---------------------------------------------------------------------------
    // Set QUEUE_ENABLED=true to enqueue review jobs via BullMQ instead of
    // running the pipeline fire-and-forget in the webhook process. Requires a
    // running Valkey/Redis instance at VALKEY_URL and a separate worker process
    // started with `bun run src/worker.ts`.
    QUEUE_ENABLED: z
      .string()
      .default("false")
      .transform((v) => v === "true"),
    // Connection URL for the Valkey/Redis instance used by BullMQ.
    VALKEY_URL: z.string().default("redis://localhost:6379"),
    // Number of review jobs the worker process handles concurrently.
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
    // Hard timeout boundary per review job attempt in the worker.
    REVIEW_JOB_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1_000),
    REVIEW_DRAFT_MRS: z
      .string()
      .default("true")
      .transform((v) => v === "true"),

    // ---------------------------------------------------------------------------
    // LLM provider fallback (Phase 5.3 — OpenAI / Google Gemini)
    // ---------------------------------------------------------------------------
    // Comma-separated ordered list of LLM providers to attempt for each
    // chatCompletion call. The first provider in the list is tried first; on
    // error, the next is tried. Valid values: bedrock, openai, google.
    // Defaults to bedrock-only (current behaviour preserved for existing deploys).
    LLM_PROVIDER_ORDER: z
      .string()
      .default("bedrock")
      .transform((v) =>
        v
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      ),

    // OpenAI fallback provider
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-4o"),

    // Google Gemini fallback provider
    GOOGLE_AI_API_KEY: z.string().optional(),
    GOOGLE_AI_MODEL: z.string().default("gemini-1.5-pro"),
  })
  // Cross-field validation: ensure required keys are present for any
  // non-Bedrock provider listed in LLM_PROVIDER_ORDER.
  .superRefine((data, ctx) => {
    if (data.LLM_PROVIDER_ORDER.includes("openai") && !data.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OPENAI_API_KEY is required when 'openai' is in LLM_PROVIDER_ORDER",
      });
    }
    if (data.LLM_PROVIDER_ORDER.includes("google") && !data.GOOGLE_AI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GOOGLE_AI_API_KEY is required when 'google' is in LLM_PROVIDER_ORDER",
      });
    }
  });

export type Config = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);

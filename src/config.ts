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
  REPO_CACHE_DIR: z.string().default("/tmp/repo_cache"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  PORT: z.coerce.number().int().positive().default(8000),
});

export type Config = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);

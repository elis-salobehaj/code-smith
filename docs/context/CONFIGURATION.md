# Configuration

Unified reference for the environment variables accepted by `src/config.ts` and the repo-level review configuration loaded from `.gitgandalf.yaml`.

| Variable | Required | Type | Default | Notes |
|---|---|---|---|---|
| `GITLAB_URL` | yes | URL string | none | Base URL for the GitLab instance. Used both by `@gitbeaker/rest` and clone-host validation. |
| `GITLAB_TOKEN` | yes | non-empty string | none | Personal/project token for GitLab API access and authenticated clone URL injection. |
| `GITLAB_WEBHOOK_SECRET` | yes | non-empty string | none | Compared against `X-Gitlab-Token` in `POST /api/v1/webhooks/gitlab`. |
| `AWS_REGION` | no | string | `us-west-2` | Used by the implemented AWS Bedrock Runtime Converse client in `src/agents/llm-client.ts`. |
| `AWS_BEARER_TOKEN_BEDROCK` | yes | non-empty string | none | Bearer token used by the implemented Bedrock Runtime client path. |
| `AWS_AUTH_SCHEME_PREFERENCE` | no | string | `smithy.api#httpBearerAuth` | Must be quoted in `.env` files because `#` begins comments in dotenv syntax. Keeps the AWS SDK on the Bedrock bearer-token auth path. |
| `LLM_MODEL` | no | string | `global.anthropic.claude-sonnet-4-6` | Bedrock model ID passed to `ConverseCommand` in `src/agents/llm-client.ts`. |
| `MAX_TOOL_ITERATIONS` | no | positive integer | `15` | Upper bound for tool-call iterations inside `investigatorLoop()`. |
| `MAX_SEARCH_RESULTS` | no | positive integer | `100` | Caps `search_codebase` results returned from ripgrep parsing. |
| `REPO_CACHE_DIR` | no | string | `/tmp/repo_cache` | Root directory for shallow repo clones managed by `RepoManager`. |
| `LOG_LEVEL` | no | enum | `info` | Wired to LogTape via `src/logger.ts`. Controls the `lowestLevel` of the root `["gandalf"]` logger category. Accepted values: `debug`, `info`, `warn`, `error`. Mapped to LogTape's level names internally. When set to `debug` outside tests, logs are also appended to `logs/gg-dev.log` under the project root. |
| `PORT` | no | positive integer | `8020` | Port used by the Bun server export in `src/index.ts`. |
| `JIRA_ENABLED` | no | boolean string | `false` | Set to `"true"` to activate Jira ticket-context enrichment. When `false`, `fetchLinkedTickets()` returns an empty array immediately and no network calls are made. |
| `JIRA_BASE_URL` | no | URL string | none | Jira Cloud base URL, e.g. `https://your-company.atlassian.net`. Required when `JIRA_ENABLED=true`. |
| `JIRA_EMAIL` | no | string | none | Email address associated with the Jira API token. Required when `JIRA_ENABLED=true`. |
| `JIRA_API_TOKEN` | no | string | none | Atlassian API token (Basic Auth credential). Generate at `https://id.atlassian.com/manage-profile/security/api-tokens`. Must be on a single unbroken line in `.env`. Required when `JIRA_ENABLED=true`. |
| `JIRA_PROJECT_KEYS` | no | comma-separated string | none | Optional allow-list of Jira project key prefixes, e.g. `SRT,ENG,PLATFORM`. When unset, all extracted keys are fetched. |
| `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID` | no | string | none | Optional custom-field ID for acceptance criteria content, e.g. `customfield_12345`. When set, that field's value is included in the normalized `JiraTicket`. |
| `JIRA_MAX_TICKETS` | no | positive integer | `5` | Maximum ticket fetches per pipeline run. Caps blast radius when many keys appear in the MR. |
| `JIRA_TICKET_TIMEOUT_MS` | no | positive integer | `5000` | Per-ticket HTTP timeout in milliseconds. Each `fetchJiraTicket()` call uses an `AbortController` to enforce this limit. |
| `GITLAB_CA_FILE` | no | file path string | none | Path to a PEM-encoded CA bundle for self-hosted GitLab instances that use a privately-signed certificate (internal / enterprise CA). When set, injected as `GIT_SSL_CAINFO` into every git subprocess (clone, fetch) and set as `NODE_EXTRA_CA_CERTS` at startup so `@gitbeaker/rest` API calls also trust the custom root. |
| `QUEUE_ENABLED` | no | boolean string | `false` | Set to `"true"` to dispatch MR reviews via the BullMQ task queue. When `false`, reviews run fire-and-forget inline in the webhook process (original behaviour). Requires a running Valkey/Redis instance and a worker process when `true`. |
| `VALKEY_URL` | no | URL string | `redis://localhost:6379` | Connection URL for the Valkey (or Redis-compatible) instance backing the BullMQ queue. Parsed at runtime into `{ host, port }` options — no standalone `ioredis` package needed. |
| `WORKER_CONCURRENCY` | no | positive integer | `2` | Number of concurrent review jobs each worker process handles. Tune based on available memory and LLM rate limits. |
| `REVIEW_JOB_TIMEOUT_MS` | no | positive integer | `600000` | Hard timeout per review-job attempt in the worker, in milliseconds. When exceeded, the attempt fails with a timeout error and BullMQ retry/dead-letter logic takes over. |
| `REVIEW_DRAFT_MRS` | no | boolean string | `true` | Controls whether automatic merge-request webhooks for draft/WIP MRs should trigger reviews. When set to `false`, draft MR webhooks return `200 Ignored`; manual `/ai-review` note commands still run. |
| `LLM_PROVIDER_ORDER` | no | comma-separated string | `bedrock` | Ordered list of LLM provider names to attempt. Supported values: `bedrock`, `openai`, `google`. On failure, the next provider is tried. E.g. `bedrock,openai` uses OpenAI as an automatic fallback. |
| `OPENAI_API_KEY` | no | string | none | OpenAI API key. Required when `openai` appears in `LLM_PROVIDER_ORDER`. |
| `OPENAI_MODEL` | no | string | `gpt-4o` | OpenAI model ID to use for chat completions. |
| `GOOGLE_AI_API_KEY` | no | string | none | Google AI (Gemini) API key. Required when `google` appears in `LLM_PROVIDER_ORDER`. |
| `GOOGLE_AI_MODEL` | no | string | `gemini-1.5-pro` | Gemini model ID to use for chat completions. |

## Validation Rules

- config is parsed once at module load time with `envSchema.parse(process.env)`
- numeric values use `z.coerce.number().int().positive()` where applicable
- invalid configuration fails fast during startup or import
- no provider SDK config leaks past `src/agents/llm-client.ts`; the rest of the app consumes the internal agent protocol only

## Test Environment Notes

- `bun test` auto-loads `.env.test`
- `.env.test` points `REPO_CACHE_DIR` at an isolated test path so repo-manager tests do not touch the production default cache
- fake Bedrock credentials are committed in `.env.test` because the schema requires those fields before modules import

## Repo Review Config Files

Phase C1 of CP1 adds repo-config parsing primitives alongside env config:

For a repo-author guide with examples, authoring standards, and troubleshooting, see [`docs/guides/REPO_REVIEW_CONFIG.md`](../guides/REPO_REVIEW_CONFIG.md).

- `src/config/repo-config.ts` defines the strict Zod schema for `.gitgandalf.yaml` or `.gitgandalf.yml`
- `src/config/repo-config-loader.ts` discovers repo config files at repo root in this order: `.gitgandalf.yaml`, then `.gitgandalf.yml`
- missing repo config falls back to `DEFAULT_REPO_CONFIG`
- malformed YAML or schema validation failures also fall back to defaults and log a warning instead of blocking the review pipeline
- supported top-level sections are `version`, `review_instructions`, `file_rules`, `exclude`, `severity`, `features`, `linters`, and `output`
- unknown keys are rejected with strict parsing so typoed config does not silently noop
- glob patterns are validated at parse time; Bun.Glob remains the default matcher, with a narrow `picomatch` fallback for trailing-slash directory patterns like `dist/` that Bun.Glob does not match against diff file paths

This loader is implemented in Phase C1 only. Pipeline attachment and config-driven behavior land in later CP1 phases.

### `.gitgandalf.yaml` schema reference

- `version`: required literal `1`
- `review_instructions`: optional non-empty string; global review guidance for later prompt-injection phases
- `file_rules`: optional array, default `[]`
	- `pattern`: required glob string
	- `severity_threshold`: optional enum `low | medium | high | critical`
	- `instructions`: optional non-empty string
	- `skip`: optional boolean
- `exclude`: optional array of glob strings, default `[]`
- `severity`: optional object
	- `minimum`: optional enum, defaults to `low`
	- `block_on`: optional enum, defaults to `high`
- `features`: optional object
	- `linter_integration`: optional boolean, defaults to `false`
	- `enhanced_summary`: optional boolean, defaults to `false`
	- `learning`: optional boolean, defaults to `false`
- `linters`: optional object
	- `enabled`: optional boolean, defaults to `false`
	- `profile`: optional non-empty string naming an instance-owned profile
	- `severity_threshold`: optional enum, defaults to `medium`
	- executable-command fields are not accepted; the object is strict and only named profile selection is allowed
- `output`: optional object
	- `max_findings`: optional positive integer, defaults to `6`
	- `include_walkthrough`: optional enum `auto | always | never`, defaults to `auto`
	- `collapsible_details`: optional boolean, defaults to `true`

### Validation semantics

- all fields other than `version` are optional; `version: 1` alone is valid
- top-level and nested objects use strict parsing, so unknown keys are rejected everywhere
- malformed YAML and schema-validation failures both degrade to defaults with a warning log
- glob validation happens at load time rather than later during review execution
- trailing-slash directory patterns such as `dist/` are normalized for matching because Bun.Glob does not match that form against diff file paths

## Planned Crown Configuration Additions

These variables are planned by CP3, CP5, CP6, and CP7, but they are not accepted by `src/config.ts` yet.

| Variable | Planned Phase | Purpose |
|---|---|---|
| `DEPLOYMENT_ROLE` | CP6 | Distinguish `webhook`, `worker`, and `ops` processes so the future ops role can own learning and analytics writes. |
| `LEARNING_ENABLED` | CP3 | Feature-flag the organizational learning subsystem during rollout. |
| `LEARNING_DB_PATH` | CP3 | Filesystem path for the phase-one SQLite database owned by the ops role. |
| `METRICS_ENABLED` | CP5 | Optional guard for the `/metrics` surface and Prometheus instrumentation rollout. |
| `ANALYTICS_RETENTION_DAYS` | CP5 | Retention window for review analytics cleanup jobs executed by the ops role. |
| admin auth settings | CP6 | Separate credentials or platform identity for `/api/v1/admin/*`, distinct from webhook auth. |
| internal read-path auth settings | CP6 | Read-only service-to-service auth for worker access to learned patterns, separate from operator admin credentials. |
| PostgreSQL settings (`POSTGRES_ENABLED`, `POSTGRES_URL`, pool/SSL options) | CP7 | Threshold-driven migration from phase-one SQLite to PostgreSQL adapters without changing queue payloads or route contracts. |

### Planned storage constraints

- Phase-one SQLite is planned only for a singleton ops deployment with block-backed `ReadWriteOnce` storage.
- Shared RWX or generic network-filesystem mounts are out of scope for the SQLite database file.
- Valkey remains queue and cache infrastructure only; future PostgreSQL settings do not replace it for BullMQ.

Current env-config source of truth remains [`src/config.ts`](../../src/config.ts). Repo-review config source of truth is [`src/config/repo-config.ts`](../../src/config/repo-config.ts).

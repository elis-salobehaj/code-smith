# Configuration (Agent Reference)

Compact reference for all environment variables accepted by `src/config.ts`.

| Variable | Required | Type | Default | Notes |
|---|---|---|---|---|
| `GITLAB_URL` | yes | URL string | none | Base URL for the GitLab instance. Used both by `@gitbeaker/rest` and clone-host validation. |
| `GITLAB_TOKEN` | yes | non-empty string | none | Personal/project token for GitLab API access and authenticated clone URL injection. |
| `GITLAB_WEBHOOK_SECRET` | yes | non-empty string | none | Compared against `X-Gitlab-Token` in `POST /api/v1/webhooks/gitlab`. |
| `AWS_REGION` | no | string | `us-west-2` | Reserved for Bedrock client setup in Phase 3. |
| `AWS_BEARER_TOKEN_BEDROCK` | yes | non-empty string | none | Required by current config schema even though Phase 1/2 do not call Bedrock yet. |
| `AWS_AUTH_SCHEME_PREFERENCE` | no | string | `smithy.api#httpBearerAuth` | Must be quoted in `.env` files because `#` begins comments in dotenv syntax. |
| `LLM_MODEL` | no | string | `global.anthropic.claude-sonnet-4-6` | Planned default model for the future Bedrock client. |
| `MAX_TOOL_ITERATIONS` | no | positive integer | `15` | Planned upper bound for investigator agent tool loops in Phase 3. |
| `MAX_SEARCH_RESULTS` | no | positive integer | `100` | Caps `search_codebase` results returned from ripgrep parsing. |
| `REPO_CACHE_DIR` | no | string | `/tmp/repo_cache` | Root directory for shallow repo clones managed by `RepoManager`. |
| `LOG_LEVEL` | no | enum | `info` | Parsed today but not yet wired to a structured logger. |
| `PORT` | no | positive integer | `8000` | Port used by the Bun server export in `src/index.ts`. |

## Validation Rules

- config is parsed once at module load time with `envSchema.parse(process.env)`
- numeric values use `z.coerce.number().int().positive()` where applicable
- invalid configuration fails fast during startup or import

## Test Environment Notes

- `bun test` auto-loads `.env.test`
- `.env.test` points `REPO_CACHE_DIR` at an isolated test path so repo-manager tests do not touch the production default cache
- fake Bedrock credentials are committed in `.env.test` because the schema requires those fields before modules import

Source of truth remains [`src/config.ts`](../../../src/config.ts).

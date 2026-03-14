# Getting Started

This guide gets the current Phase 2.5 implementation running locally.

## Prerequisites

- Bun
- Git
- ripgrep (`rg`) for the context tools
- a GitLab token and webhook secret
- Bedrock bearer token values, because `src/config.ts` validates them at startup even though Bedrock is not called yet

## 1. Install dependencies

```bash
bun install
```

## 2. Create your local environment file

Start from `.env.example` and provide real values.

Required values today:

- `GITLAB_URL`
- `GITLAB_TOKEN`
- `GITLAB_WEBHOOK_SECRET`
- `AWS_BEARER_TOKEN_BEDROCK`

Important:

- keep `AWS_AUTH_SCHEME_PREFERENCE='smithy.api#httpBearerAuth'` quoted
- `MAX_SEARCH_RESULTS` controls the cap used by `search_codebase`
- `REPO_CACHE_DIR` is where shallow clones will be cached

## 3. Start the service

```bash
bun run dev
```

The server listens on `PORT` from the config, default `8000`.

## 4. Verify health

```bash
curl http://localhost:8000/api/v1/health
```

Expected response:

```json
{"status":"ok","timestamp":"2026-03-14T00:00:00.000Z"}
```

## 5. Send a sample webhook

```bash
curl -X POST http://localhost:8000/api/v1/webhooks/gitlab \
	-H "Content-Type: application/json" \
	-H "X-Gitlab-Token: <your-webhook-secret>" \
	-d @tests/fixtures/sample_mr_event.json
```

Current behavior:

- matching merge request events return `202 Accepted`
- non-matching but valid events return `200 Ignored`
- the pipeline only logs the event today; no clone, LLM call, or GitLab comment is performed yet

## 6. Understand the current scope

Implemented now:

- Hono listener and health endpoint
- strict Zod webhook parsing
- GitLab client wrapper
- repo cache manager
- modular tool surface for future agents

Not implemented yet:

- multi-agent review orchestration
- GitLab comment publishing
- Docker deployment files

## Useful next commands

```bash
bun test
bun run typecheck
bun run check
```

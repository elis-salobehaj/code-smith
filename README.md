# GitGandalf 🧙‍♂️

Self-hosted, multi-agent code review service for GitLab. Intercepts merge request events, deeply reasons about code changes using an LLM-powered three-agent pipeline, and posts high-signal inline review comments directly on the MR diff.

## How It Works

```
GitLab Webhook → Hono Listener → Agent Pipeline → GitLab MR Comments
```

1. **GitLab** sends a webhook on MR open/update or when someone comments `/ai-review`.
2. **Agent 1 — Context & Intent** analyses the diff and MR description to understand the developer's intent and identify risk areas.
3. **Agent 2 — Socratic Investigator** uses `read_file`, `search_codebase`, and `get_directory_structure` tools to explore the full repository and gather evidence for each risk hypothesis.
4. **Agent 3 — Reflection & Consolidation** filters out noise, verifies evidence, and produces a final verdict (`APPROVE`, `REQUEST_CHANGES`, or `NEEDS_DISCUSSION`).
5. **Publisher** posts inline discussions on the MR diff for each verified finding, plus a summary note with the overall verdict.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3.10
- [Docker](https://docs.docker.com/get-docker/) + Compose plugin (for containerised deployment)
- A GitLab instance with a personal access token (`api` scope)
- AWS Bedrock access with Claude Sonnet 4 enabled in your region (bearer-token auth)

## Configuration

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `GITLAB_URL` | Base URL of your GitLab instance, e.g. `https://gitlab.example.com` |
| `GITLAB_TOKEN` | GitLab personal access token with `api` scope |
| `GITLAB_WEBHOOK_SECRET` | Shared secret used to verify incoming webhooks |
| `AWS_REGION` | AWS region where Bedrock is enabled, e.g. `us-west-2` |
| `AWS_BEARER_TOKEN_BEDROCK` | Bearer token for AWS Bedrock API access |
| `LLM_MODEL` | Bedrock model ID (default: `global.anthropic.claude-sonnet-4-6`) |
| `MAX_TOOL_ITERATIONS` | Max tool-call rounds in Agent 2 (default: `15`) |
| `REPO_CACHE_DIR` | Path for shallow git clones (default: `/tmp/repo_cache`) |
| `PORT` | HTTP port (default: `8000`) |

## Running Locally

```bash
# Install dependencies
bun install

# Start with hot-reload
bun run dev
```

The server listens on `http://localhost:8000`.

### GitLab Webhook Setup

1. Go to your GitLab project → **Settings → Webhooks**.
2. Set the URL to `https://<your-host>/api/v1/webhooks/gitlab`.
3. Set the **Secret token** to the value of `GITLAB_WEBHOOK_SECRET`.
4. Enable **Merge request events** and **Comments**.
5. Click **Add webhook**.

Trigger a review manually by posting a comment `/ai-review` on any open MR.

## Running with Docker

```bash
# Build and start
docker compose up --build

# Run in the background
docker compose up -d --build
```

The `repo-cache` Docker volume persists shallow git clones between container restarts.

## Development

```bash
# Run tests
bun test

# Type-check
bun run typecheck

# Lint + format (applies fixes)
bun run check

# Full CI gate (no fixes, exits non-zero on any error)
bun run ci
```

## Project Structure

```
src/
├── index.ts              # Hono server bootstrap
├── config.ts             # Zod-validated environment config
├── api/
│   ├── router.ts         # Webhook + health routes
│   ├── schemas.ts        # Zod schemas for GitLab payloads
│   └── pipeline.ts       # Full orchestration entry-point
├── gitlab-client/
│   ├── client.ts         # @gitbeaker/rest wrapper
│   └── types.ts          # Domain types (MRDetails, DiffFile, etc.)
├── context/
│   ├── repo-manager.ts   # Shallow git clone + TTL eviction
│   └── tools/            # Agent tools (read_file, search_codebase, get_directory_structure)
├── agents/
│   ├── orchestrator.ts   # 3-agent state-machine pipeline
│   ├── state.ts          # ReviewState + Finding types
│   ├── llm-client.ts     # AWS Bedrock SDK wrapper
│   ├── context-agent.ts  # Agent 1: intent mapping
│   ├── investigator-agent.ts  # Agent 2: tool-calling investigation loop
│   └── reflection-agent.ts   # Agent 3: filtering and verdict
└── publisher/
    └── gitlab-publisher.ts   # Format findings → GitLab inline comments
```

## Documentation

Full documentation index: [`docs/README.md`](docs/README.md).
Architecture reference: [`docs/agents/context/ARCHITECTURE.md`](docs/agents/context/ARCHITECTURE.md).

## Tech Stack

- **Runtime**: Bun · **Framework**: Hono · **Language**: TypeScript (strict)
- **LLM**: AWS Bedrock (Claude Sonnet 4) · **GitLab**: @gitbeaker/rest
- **Validation**: Zod · **Lint/Format**: Biome

## License

MIT

## License

Apache 2.0 — see [LICENSE](LICENSE).

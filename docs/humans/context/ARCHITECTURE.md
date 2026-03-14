# Architecture

GitGandalf is a Bun-native webhook service that is being built in phases. As of Phase 2.5, the repository contains a complete webhook ingestion layer, a typed GitLab client, a repo cache manager, and a modular tool execution surface. The full multi-agent reviewer and GitLab publishing loop are designed but not wired yet.

For the concise agent-optimized version, see [`docs/agents/context/ARCHITECTURE.md`](../../agents/context/ARCHITECTURE.md).

## Current Implemented Architecture

```mermaid
graph TD
	A[GitLab Webhook] --> B[Hono app in src/index.ts]
	B --> C[apiRouter]
	C --> D{Secret + Zod validation}
	D -->|invalid| E[400 or 401 response]
	D -->|ignored event| F[200 Ignored]
	D -->|accepted event| G[runPipeline stub]
	G --> H[console log only]

	I[RepoManager] --> J[shallow clone/update cache]
	K[Tool Barrel] --> L[read_file]
	K --> M[search_codebase]
	K --> N[get_directory_structure]
```

## Directory Structure

```text
git-gandalf/
├── .env.example                    # Template for secrets & config
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── package.json                    # Dependencies & scripts
├── tsconfig.json                   # TypeScript configuration
├── bunfig.toml                     # Bun-specific config (optional)
├── README.md
├── src/
│   ├── index.ts                    # Hono app entrypoint + server bootstrap
│   ├── config.ts                   # Env vars via Zod-validated process.env
│   ├── api/
│   │   ├── router.ts               # Webhook + health route definitions
│   │   ├── schemas.ts              # Zod schemas for GitLab webhook payloads
│   │   └── pipeline.ts             # Typed pipeline entry-point stub (filled in Phase 2–4)
│   ├── gitlab-client/
│   │   ├── client.ts               # @gitbeaker/rest wrapper (fetch MR, diff, discussions)
│   │   └── types.ts                # TypeScript types for GitLab data (MRDetails, DiffFile, etc.)
│   ├── context/
│   │   ├── repo-manager.ts         # Clone/cache repos via Bun.spawn + git CLI
│   │   └── tools/                  # Agent tools — one file per tool
│   │       ├── index.ts            # Aggregates TOOL_DEFINITIONS[], exports executeTool()
│   │       ├── shared.ts           # SearchResult type + assertInsideRepo() guard
│   │       ├── read-file.ts        # read_file tool definition + implementation
│   │       ├── search-codebase.ts  # search_codebase tool definition + implementation
│   │       └── get-directory-structure.ts  # get_directory_structure tool definition + implementation
│   ├── agents/
│   │   ├── orchestrator.ts         # Custom state-machine pipeline (runReview entrypoint)
│   │   ├── state.ts                # ReviewState type + Finding type definitions
│   │   ├── llm-client.ts           # Bedrock/Anthropic SDK wrapper + tool-call helpers
│   │   ├── context-agent.ts        # Agent 1: Context & Intent Mapper
│   │   ├── investigator-agent.ts   # Agent 2: Socratic Investigator (tool loop)
│   │   └── reflection-agent.ts     # Agent 3: Reflection & Consolidation
│   └── publisher/
│       └── gitlab-publisher.ts     # Format findings → GitLab inline comments + summary
└── tests/
	├── fixtures/
	│   ├── sample_mr_event.json    # Sample MR open event payload
	│   └── sample_note_event.json  # Sample /ai-review note event payload
	├── webhook.test.ts             # Phase 1 tests
	├── tools.test.ts               # Phase 2 tests
	├── agents.test.ts              # Phase 3 tests
	└── publisher.test.ts           # Phase 4 tests
```

## Phase Ownership

| Area | Current Status | Owning Phase | Notes |
|---|---|---|---|
| `src/index.ts`, `src/api/`, `src/config.ts` | Implemented | Phase 1 | Webhook ingress, health endpoint, strict payload validation, and config loading are live. |
| `src/gitlab-client/` | Implemented | Phase 1 | Typed GitLab wrapper exists, including read and write methods needed by later phases. |
| `src/context/repo-manager.ts` | Implemented | Phase 2 | Shallow clone/update cache manager with TTL cleanup and host validation. |
| `src/context/tools/` | Implemented | Phase 2 and 2.5 | Tool surface exists and was modularized in Phase 2.5 into one file per tool. |
| `src/agents/` | Planned | Phase 3 | State model, Bedrock client, context agent, investigator agent, reflection agent, and orchestrator are still to be implemented. |
| `src/publisher/` | Planned | Phase 4 | GitLab publisher for inline comments and summary comment is not implemented yet. |
| `Dockerfile`, `docker-compose.yml`, top-level `README.md` | Planned | Phase 4 | Deployment packaging and end-user project documentation remain open. |
| `tests/webhook.test.ts` | Implemented | Phase 1 | Covers auth, filtering, invalid payloads, and strict schema behavior. |
| `tests/tools.test.ts`, `tests/repo-manager.test.ts` | Implemented | Phase 2 and 2.5 | Covers tool sandboxing, search and tree behavior, repo cache cleanup, and SSRF guard behavior. |
| `tests/agents.test.ts`, `tests/publisher.test.ts` | Planned | Phases 3 and 4 | Reserved for future orchestration and publishing coverage. |

## Implemented Components

### Hono server

- `src/index.ts` creates the app, enables request logging, mounts `/api/v1`, and exports Bun server config.
- `GET /api/v1/health` returns `{ status: "ok", timestamp }`.

### Webhook router

`src/api/router.ts` does four real jobs today:

1. verifies the GitLab shared secret
2. validates webhook payloads with strict Zod schemas
3. filters down to merge-request review triggers
4. hands the event to `runPipeline(event)` without blocking the HTTP response

The filter rules are intentionally narrow:

- merge request actions: `open`, `update`, `reopen`
- note trigger: `/ai-review` comment on a merge request

### Zod schema boundary

`src/api/schemas.ts` defines strict object schemas for:

- project identity
- user identity
- merge request attributes
- note attributes
- a discriminated union over `object_kind`

This means extra top-level keys are rejected rather than tolerated silently.

### GitLab client wrapper

`src/gitlab-client/client.ts` wraps `@gitbeaker/rest` behind a smaller domain API:

- `getMRDetails()`
- `getMRDiff()`
- `getMRDiscussions()`
- `createMRNote()`
- `createInlineDiscussion()`

The wrapper also handles gitbeaker’s awkward snake_case response shapes and camelCase create-option shapes in one place.

### Repo cache manager

`src/context/repo-manager.ts` is the first piece of the future context engine.

- repo cache path: `<REPO_CACHE_DIR>/<projectId>`
- first-time path: `git clone --depth 1 --branch <branch>`
- refresh path: `git fetch origin <branch> --depth 1` + `git reset --hard origin/<branch>`
- cleanup: TTL-based eviction using directory `mtime`

Security detail: the clone URL hostname must match `GITLAB_URL`. The manager refuses to inject the GitLab token into a different host, which blocks token exfiltration through a malicious webhook payload.

### Modular tool system

Phase 2.5 split the original monolithic `src/context/tools.ts` into per-tool modules under `src/context/tools/`.

- `read-file.ts`
- `search-codebase.ts`
- `get-directory-structure.ts`
- `shared.ts`
- `index.ts`

This keeps each tool independently testable and makes the public API surface explicit in one place.

## What Is Still Planned

The target architecture in the master plan goes further than the current implementation.

### Phase 3

- `src/agents/state.ts`
- `src/agents/llm-client.ts`
- context, investigator, and reflection agents
- orchestrator with optional reinvestigation loop

### Phase 4

- publisher that turns verified findings into MR comments
- full pipeline wiring from webhook → clone → review → publish
- Docker packaging and top-level README

## Why the Design Looks This Way

- Bun is used directly for runtime, subprocesses, and file access to keep the stack small and fast.
- Zod is used at all external boundaries so invalid inputs fail before they enter core logic.
- The tool system is split by file so future tools are modular and reusable.
- The agent orchestrator is deferred until the repo exploration and tooling substrate is stable.

## ELI5

Right now GitGandalf can answer the phone, check who is calling, decide whether the call matters, and log the job that should happen next. It also already has the toolbox ready for the future reviewer agents. What it does not do yet is perform the review itself or post comments back to GitLab.

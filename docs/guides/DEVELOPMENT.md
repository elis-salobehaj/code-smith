# Development Guide

This repository is plan-driven and Bun-first. Use the active plan and AGENTS.md as part of the development contract, not as optional reference material.

## Logging conventions

All source modules use LogTape via `src/logger.ts`. Never use bare `console.*` in `src/` — log output must route through LogTape so `LOG_LEVEL` filtering and request correlation work correctly.

When `LOG_LEVEL=debug` outside tests, the application also appends JSON Lines logs to `logs/gg-dev.log` in the project root. This is the primary place to inspect a noisy local review run after the terminal scrollback becomes unwieldy.

### Adding a logger to a new module

```typescript
import { getLogger } from "../logger"; // adjust relative path as needed

const logger = getLogger(["gandalf", "<module>"]);

// Simple message
logger.info("Thing happened");

// Structured properties — prefer this over string interpolation
logger.info("Review complete", { verdict, findings: count });

// Error handling — always extract message
logger.error("Failed to post comment", { error: err instanceof Error ? err.message : String(err) });
```

### Category naming

All loggers root at `"gandalf"`. Sub-categories follow the module hierarchy:

| Module | Category |
|---|---|
| `src/api/router.ts` | `["gandalf", "router"]` |
| `src/api/pipeline.ts` | `["gandalf", "pipeline"]` |
| `src/agents/orchestrator.ts` | `["gandalf", "orchestrator"]` |
| `src/integrations/jira/client.ts` | `["gandalf", "jira"]` |
| `src/publisher/gitlab-publisher.ts` | `["gandalf", "publisher"]` |

### Request correlation

`withContext()` propagates values to all log lines emitted within the async call stack:

```typescript
import { withContext } from "../logger";

// In the router, wrapping the pipeline call:
withContext({ requestId }, () => { runPipeline(event); });

// In the pipeline, enriching with MR identity:
await withContext({ projectId, mrIid }, async () => { /* ... */ });
```

All downstream log lines — including those in orchestrator and publisher — automatically carry `requestId`, `projectId`, and `mrIid`.

### Level guide

- `debug` — verbose internal state (tool calls, agent stages, filtered items)
- `info` — key lifecycle events (pipeline start/end, review verdict)
- `warn` — recoverable issues (non-diff findings skipped, validation failures)
- `error` — failures that need investigation (unhandled pipeline errors, failed comment posts)

## Core commands

```bash
bun run dev
bun test
bun run typecheck
bun run check
bunx biome ci .
```

## Workflow rules

### 1. Work from the active plan

- use `docs/plans/active/git-gandalf-master-plan.md` as the implementation backlog
- update plan checkboxes as work completes
- update `docs/README.md` when a phase status changes

### 2. Respect the plan completion gate

Before a plan phase is considered complete:

- run the `review-plan-phase` audit
- address approved findings
- ensure code, tests, docs, and plan bookkeeping all align

### 3. Keep Bun as the only workflow

- use `bun install`, `bun run`, `bun test`, `bunx`
- do not add npm, pnpm, yarn, ts-node, tsx, or dotenv-based workflows

### 4. Validate all external inputs with Zod

- env config: `src/config.ts`
- webhook payloads: `src/api/schemas.ts`
- future LLM outputs should follow the same rule

## Testing strategy

Current tests:

- `tests/webhook.test.ts`: router auth, JSON handling, schema validation, event filtering
- `tests/tools.test.ts`: tool sandboxing, formatting, directory tree output, ripgrep integration, dispatcher validation
- `tests/agents.test.ts`: protocol helpers, parsers, and orchestrator-level behavior
- `tests/agents-entrypoints.test.ts`: direct agent entrypoints with mocked model responses, including tool-failure recovery
- `tests/repo-manager.test.ts`: cache path, TTL cleanup, SSRF host validation
- `tests/publisher.test.ts`: inline publication, duplicate detection, anchoring, and summary-note behavior
- `tests/logger.test.ts`: LogTape configuration, filtering, and structured logging behavior
- `tests/jira.test.ts`: `extractTicketKeys` pure function, `fetchJiraTicket` with mocked fetch, and `fetchLinkedTickets` integration covering disabled guard, key extraction, allow-list filtering, per-run cap, dedup, and ADF description parsing

Use the repository's actual `bun test` output as the source of truth for suite size. The count changes as the implementation evolves.

## Working on tools

Tool modules live under `src/context/tools/`.

Pattern for a new tool:

1. create `src/context/tools/<tool-name>.ts`
2. export `toolDefinition`, `inputSchema`, and the implementation
3. register the tool in `src/context/tools/index.ts`
4. add tool behavior tests to `tests/tools.test.ts`

Tool definitions are part of GitGandalf's internal protocol boundary. Keep provider SDK types out of `src/context/tools/`.

## Security expectations

- path-based tools must stay sandboxed to the repo root
- clone URLs must not leak credentials to untrusted hosts
- prefer root-cause fixes over thin wrappers around unsafe behavior

## Before committing

Run:

```bash
bun run check
bun run typecheck
bun test
```

If the work is plan-driven, also confirm docs and plan files were updated in the same change.

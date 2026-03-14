# Development Guide

This repository is plan-driven and Bun-first. Use the active plan and AGENTS.md as part of the development contract, not as optional reference material.

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
- `tests/repo-manager.test.ts`: cache path, TTL cleanup, SSRF host validation

The current suite totals 48 passing tests.

## Working on tools

Tool modules live under `src/context/tools/`.

Pattern for a new tool:

1. create `src/context/tools/<tool-name>.ts`
2. export `toolDefinition`, `inputSchema`, and the implementation
3. register the tool in `src/context/tools/index.ts`
4. add tool behavior tests to `tests/tools.test.ts`

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

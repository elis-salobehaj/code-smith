# Agent Documentation

This directory contains concise, token-optimized documentation intended for agent consumption. Prefer these files over the human docs when building context for implementation or review work.

## Context References

- [Architecture](./context/ARCHITECTURE.md) — current runtime surface, webhook flow, repo manager, tool system, internal protocol boundary, and implemented publishing behavior
- [Configuration](./context/CONFIGURATION.md) — compact env var table sourced from `src/config.ts`
- [Workflows](./context/WORKFLOWS.md) — implemented request flow, repo cache workflow, tool dispatch, incremental review behavior, tool-failure recovery, and logging/observability

## Design References

- [Tech Stack Evaluation](./designs/tech-stack-evaluation.md) — concise summary of why Bun, Hono, Zod, Bedrock, and native Git were selected

## Logging Convention

All source modules use LogTape via `src/logger.ts`. Import `getLogger` and call it with a hierarchical category:

```typescript
import { getLogger } from "../logger";
const logger = getLogger(["gandalf", "<module>"]);
```

Never use bare `console.*` in `src/` — all log output must route through LogTape so `LOG_LEVEL` filtering and request correlation work correctly. See the [Development Guide](../../guides/DEVELOPMENT.md) for the full logging conventions section.

## Usage Rule

When both agent and human docs exist for the same topic, agents should default to the `docs/agents/` version unless detailed rationale or diagrams are required.

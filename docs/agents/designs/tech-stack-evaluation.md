# Tech Stack Evaluation — Design Choices

## Architecture
- **Runtime**: Bun
- **Framework**: Hono
- **Language**: TypeScript
- **LLM**: AWS Bedrock via `@anthropic-ai/bedrock-sdk` (Claude Sonnet 4)
- **Agent Orchestration**: Custom state-machine orchestrator (~250 LOC) — chosen over LangGraph.js for simplicity, type safety, and debugging linear loops.
- **GitLab Client**: `@gitbeaker/rest`
- **Git Operations**: `Bun.spawn()` + native Git CLI — fastest subprocess execution.
- **Validation**: Zod (for env, webhook payloads, outputs).

## Tooling
- **Linting/Formatting**: Biome (replaces ESLint/Prettier).
- **Task Queue**: BullMQ + Valkey (Phase 5+).

## Decisions
- Avoid python-based AI orchestration in favor of native TS, maintaining end-to-end type safety.
- Avoid `isomorphic-git` due to massive performance penalties for backend Docker deployments. Use native Git wrappers.

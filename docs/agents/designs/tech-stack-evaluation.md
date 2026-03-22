# Tech Stack Evaluation — Design Choices

## Architecture
- **Runtime**: Bun
- **Framework**: Hono
- **Language**: TypeScript
- **LLM**: AWS Bedrock via `@aws-sdk/client-bedrock-runtime` (Claude Sonnet 4 via Converse)
- **App Boundary**: GitGandalf-owned internal protocol in `src/agents/protocol.ts`
- **Agent Orchestration**: Custom state-machine orchestrator (~250 LOC) — chosen over LangGraph.js for simplicity, type safety, and debugging linear loops.
- **GitLab Client**: `@gitbeaker/rest`
- **Git Operations**: `Bun.spawn()` + native Git CLI — fastest subprocess execution.
- **Validation**: Zod (for env, webhook payloads, outputs).

## Tooling
- **Linting/Formatting**: Biome (replaces ESLint/Prettier).
- **Task Queue**: BullMQ + Valkey (implemented in Phase 5).

## Decisions
- Avoid python-based AI orchestration in favor of native TS, maintaining end-to-end type safety.
- Avoid `isomorphic-git` due to massive performance penalties for backend Docker deployments. Use native Git wrappers.
- Keep provider SDK message and tool shapes boxed into `src/agents/llm-client.ts` rather than letting them define the rest of the app.
- Keep tool definitions internal to the repo so agent behavior is provider-agnostic above the adapter layer.

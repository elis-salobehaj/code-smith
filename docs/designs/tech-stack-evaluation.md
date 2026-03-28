# Tech Stack Evaluation — Current Decision Record

This document records the current GitGandalf stack decision after the live Bedrock
integration work and the internal protocol refactor.

## Current Verdict

GitGandalf standardizes on:

- **Runtime**: Bun
- **Framework**: Hono
- **Language**: TypeScript
- **Validation**: Zod
- **LLM transport**: AWS Bedrock Runtime Converse via `@aws-sdk/client-bedrock-runtime`
- **Agent contract**: GitGandalf-owned internal message and tool schema in `src/agents/protocol.ts`
- **GitLab client**: `@gitbeaker/rest`
- **Repo access**: native `git` + `ripgrep` via `Bun.spawn()`

## Why This Replaced The Earlier Bedrock Recommendation

An earlier version of the repo recommended the Anthropic Bedrock wrapper because it
offered a familiar Messages API shape.

That is no longer the current recommendation.

The repo now uses the official AWS Bedrock Runtime SDK directly because:

- the implemented local and enterprise auth path is Bedrock bearer-token auth
- the Bedrock Converse API is the real provider boundary we need to support
- the app now owns its own internal agent protocol, so provider SDK message shapes
  no longer need to define the rest of the codebase
- keeping Bedrock-specific behavior isolated in `src/agents/llm-client.ts` is
  cleaner than letting any external SDK shape leak into agent state, prompts, or tests

## Current Best-Practice Architecture

### Internal contract first

GitGandalf uses an app-owned protocol in `src/agents/protocol.ts` for:

- agent messages
- tool calls
- tool results
- stop reasons
- tool definitions

This is the main architectural decision.

Provider SDKs are adapters around this boundary.

### Bedrock adapter second

`src/agents/llm-client.ts` converts between:

- GitGandalf internal protocol
- AWS Bedrock Runtime Converse request/response shapes

This keeps the provider integration replaceable without forcing the rest of the
pipeline to understand Bedrock-specific or framework-specific types.

### Tool system stays internal

The tool manifest in `src/context/tools/` now also uses the internal GitGandalf
tool-definition schema. The investigator loop depends on the app-owned protocol,
not on provider SDK tool types.

## Why Not Make Vercel AI SDK The Core Abstraction

Vercel AI SDK remains a reasonable future adapter candidate, but it is not the
right domain boundary for this repo.

GitGandalf is not a generic text-generation app. It is a backend review system with:

- a structured multi-agent workflow
- persisted tool-calling state
- MR review findings and verdicts
- strict validation at LLM boundaries
- GitLab publishing behavior tied to review semantics

That means the app should own its own protocol first.

If Vercel AI SDK is evaluated later, it should sit **under** the GitGandalf
protocol as an adapter option, not replace the protocol itself.

## Current Recommendation

For new work in this repo:

1. Extend `src/agents/protocol.ts` when agent semantics change.
2. Keep `src/agents/llm-client.ts` as the provider adapter boundary.
3. Keep tool definitions internal to the repo.
4. Treat external SDKs and frameworks as replaceable implementation details.

## Historical Note

If you encounter older references to a Bedrock wrapper in archived plans,
old discussion threads, or previous design drafts, treat them as superseded by the
current Bedrock Runtime + internal-contract architecture.

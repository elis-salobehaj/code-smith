## Plan Review: GitGandalf Master Plan — Phase 5 (Production Hardening)

**Plan file**: `docs/plans/active/git-gandalf-master-plan.md`
**Reviewed against**: AGENTS.md, docs/context/*, active plans
**Verdict**: 🟢 READY

### Summary

Phase 5 is now complete under the strict plan gate. The queue path acknowledges only after
BullMQ accepts the job, each worker attempt is bounded by `REVIEW_JOB_TIMEOUT_MS`, terminal
failures are copied into a dedicated dead-letter queue, the Gemini adapter’s tool-result
mapping bug is fixed, and the Kubernetes secret instructions are correct for `stringData`.
Code, tests, docs, and plan bookkeeping are now aligned.

**Findings**: 0 BLOCKER · 0 RISK · 0 OPTIMIZATION

---

### Confirmed Strengths

- **BullMQ client compatibility**: Connection options use a plain `{ host, port, ... }` object
  (no standalone ioredis package) — correctly follows the plan's requirement to use BullMQ's
  documented Redis client path.
- **Enqueue acknowledgment is now correct**: queue mode returns `202` only after BullMQ accepts the job; enqueue failures return `503` instead of silently dropping work.
- **Explicit timeout boundary**: each worker attempt is bounded by `REVIEW_JOB_TIMEOUT_MS`, with regression coverage in `tests/review-worker-core.test.ts`.
- **Dedicated dead-letter queue**: terminal failures are copied into `review-dead-letter` with failure metadata so operators can inspect or replay them separately from the main queue.
- **Provider boundary isolation**: All three provider adapters speak `AgentMessage[]` / `AgentResponse` internally. No SDK types cross the `chatCompletion()` boundary.
- **`tryProvidersInOrder` testability design**: Moving the fallback logic to `src/agents/provider-fallback.ts` makes it unit-testable without `mock.module()`, solving the Bun module-cache isolation issue cleanly.
- **Gemini tool-result mapping fixed**: the Google adapter now maps current-turn `tool_result` blocks back to the originating tool name, matching Gemini’s `functionResponse.name` requirement, with regression coverage.
- **Graceful shutdown**: Worker entrypoint handles SIGTERM/SIGINT with `worker.close()` and correct 660s `terminationGracePeriodSeconds` in Kubernetes (10 min pipeline lock + 1 min buffer).
- **Zod at job boundary**: `review-worker.ts` re-validates job data on pickup with `reviewJobDataSchema.parse()` and re-runs `webhookPayloadSchema.parse()` so schema changes across deploys are caught at the worker, not at publish time.
- **QUEUE_ENABLED=false backward compatibility**: Fire-and-forget path is fully preserved; existing deployments do not need Valkey or a worker process to continue working.
- **Kubernetes secret instructions corrected**: `k8s/secret.yaml` now correctly states that `stringData` values are plain text and are encoded by Kubernetes automatically.

---

### Verdict & Remediation Details

Phase 5 is 🟢 READY. The previous docs/test gaps are closed, the queue acknowledgment semantics
are correct, the Gemini fallback bug is fixed, the Kubernetes secret guidance is correct, and
the remaining timeout/dead-letter blocker is now implemented and tested.

### Ordered Remediation Steps

- [x] **[agent] B1 — Implement timeout and dead-letter handling for queued reviews**: added `REVIEW_JOB_TIMEOUT_MS`, a dedicated `review-dead-letter` queue, and queue/worker tests covering timeout expiry and dead-letter routing.

### Required Validations

- [x] `bun run check` — clean (no fixes, no warnings)
- [x] `bun run typecheck` — clean
- [x] `bun test` — 221 pass, 0 fail

### Remediation Complete

The following fixes were executed in this pass:

- **Queue enqueue acknowledgment**: `src/api/router.ts` now awaits `queue.add()` and returns `503` when the queue is unavailable, rather than returning `202` and silently losing work.
- **Queue-dispatch tests updated**: `tests/webhook.test.ts` now verifies both successful enqueue (`202`) and enqueue failure (`503`) under `QUEUE_ENABLED=true`.
- **Gemini adapter fix**: `src/agents/providers/google.ts` now uses the originating tool name, not the tool call ID, for current-turn `functionResponse.name`.
- **Gemini regression coverage**: added `tests/google-provider.test.ts` to assert correct `functionResponse.name` mapping.
- **Kubernetes secret guidance**: `k8s/secret.yaml` now correctly documents `stringData` semantics.
- **Queue timeout boundary**: added `REVIEW_JOB_TIMEOUT_MS` in config/env/docs and enforced it in `src/queue/review-worker-core.ts`.
- **Dead-letter handling**: added `src/queue/dead-letter.ts`; terminal review failures are copied into `review-dead-letter` with failure metadata, with unit coverage in `tests/review-worker-core.test.ts`.

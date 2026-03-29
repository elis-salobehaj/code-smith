---
title: "CP3.A1 — Review Memory Foundation"
status: active
priority: high
estimated_hours: 24-40
dependencies:
  - docs/plans/backlog/organizational-learning-plan.md
  - docs/plans/backlog/production-hardening-plan.md
  - docs/designs/review-memory-foundation.md
created: 2026-03-29
date_updated: 2026-03-29

related_files:
  - src/api/router.ts
  - src/api/schemas.ts
  - src/api/trigger.ts
  - src/queue/job-schemas.ts
  - src/queue/review-queue.ts
  - src/queue/review-worker-core.ts
  - src/gitlab-client/client.ts
  - src/gitlab-client/types.ts
  - src/publisher/gitlab-publisher.ts
  - src/publisher/checkpoint.ts
  - src/config.ts
  - src/logger.ts
  - tests/webhook.test.ts
  - tests/pipeline.test.ts
  - tests/review-worker-core.test.ts
  - tests/publisher.test.ts
  - docs/context/WORKFLOWS.md
  - docs/context/ARCHITECTURE.md
  - docs/context/CONFIGURATION.md
  - docs/README.md

tags:
  - review-memory
  - gitlab
  - webhook
  - mem0
  - postgres
  - pgvector
  - crown-plan
  - CP3

completion:
  - "# Phase F0 — Contracts & Gating"
  - [ ] F0.1 Finalize the note-event eligibility contract for review-memory teaching in docs/designs/review-memory-foundation.md
  - [ ] F0.2 Confirm PH0 prerequisites that this slice assumes, especially admin route scaffolding, singleton ops deployment, and internal write ownership
  - [ ] F0.3 Define feature flags for note-trigger expansion and memory acknowledgments
  - [ ] F0.4 Update docs/README.md and crown-plan references for this active slice
  - "# Phase F1 — Webhook Expansion"
  - [ ] F1.1 Extend webhook schemas to distinguish `/ai-review` commands from `@code-smith` memory-teach note events
  - [ ] F1.2 Update router dispatch so merge-request note events can enqueue a review-memory teaching flow without regressing existing review triggers
  - [ ] F1.3 Add validation for bot-mention scope, merge-request context, author eligibility, and idempotency markers
  - [ ] F1.4 Add tests covering trigger precedence, ignored notes, and malformed payload rejection
  - "# Phase F2 — Queue & Worker Contracts"
  - [ ] F2.1 Add a dedicated memory-teach queue payload schema with explicit provenance fields
  - [ ] F2.2 Route memory-teach jobs through ops-owned processing boundaries rather than ad hoc route-handler writes
  - [ ] F2.3 Add worker-core orchestration for fetch-thread, classify-memory, persist-memory, and publish-ack steps
  - [ ] F2.4 Add retry, dedupe, and checkpoint semantics for memory-teach jobs
  - [ ] F2.5 Add tests for job schema validation, idempotent retries, and checkpoint recovery
  - "# Phase F3 — GitLab Interaction Loop"
  - [ ] F3.1 Add GitLab client support for loading the surrounding note thread and posting same-thread acknowledgment replies
  - [ ] F3.2 Add hidden acknowledgment markers so repeated deliveries do not create duplicate bot replies
  - [ ] F3.3 Define acknowledgment copy and fallback behavior when extraction fails or no durable memory is created
  - [ ] F3.4 Add tests for same-thread ack placement, dedupe, and safe no-op cases
  - "# Phase F4 — Memory Service Boundary"
  - [ ] F4.1 Introduce CodeSmith-owned review-memory interfaces that isolate Mem0 and PostgreSQL implementation details
  - [ ] F4.2 Define the minimum provenance registry persisted by CodeSmith alongside semantic memory writes
  - [ ] F4.3 Add configuration and readiness checks for the memory service boundary
  - [ ] F4.4 Add tests for persistence success, duplicate suppression, and degraded dependency handling
  - "# Phase F5 — Prompt Injection Readiness"
  - [ ] F5.1 Define the retrieval contract that later investigator/reflection work will consume
  - [ ] F5.2 Record unresolved ranking, scoping, and admin-lifecycle questions for the next CP3 slice
  - [ ] F5.3 Run review-plan-phase or equivalent audit before closing the slice
---

# CP3.A1 — Review Memory Foundation

## Purpose

This active slice turns the new CP3 memory-first direction into the first implementation-ready phase. Its job is not to complete the entire organizational-learning system. Its job is to establish the minimum operational foundation required to learn durable guidance from explicit GitLab reviewer replies to CodeSmith comments.

Concretely, this slice covers:

- note-webhook expansion for `@code-smith` teaching interactions
- queue and worker contracts for memory-teach jobs
- same-thread acknowledgment replies with idempotency markers
- a CodeSmith-owned boundary around Mem0 plus PostgreSQL writes and provenance capture
- retrieval-contract definition for later prompt injection work

It does not yet attempt broad ranking logic, admin editing UX, or full prompt-injection rollout.

## Scope

### In Scope

- distinguish `@code-smith` teaching notes from `/ai-review` command notes
- validate note eligibility and enqueue a dedicated memory-teach job
- fetch sufficient GitLab thread context to ground extraction
- classify whether a durable memory should be created
- persist memory via CodeSmith-owned interfaces backed by Mem0 plus PostgreSQL
- post a same-thread acknowledgment reply when a durable memory is stored or an explicit safe no-op outcome is reached
- record provenance and idempotency information needed for retries and future admin tooling
- define the read contract for later retrieval and prompt injection phases

### Out Of Scope

- broad memory ranking or long-horizon decay policy
- repository/team/user scope resolution beyond the minimal contract needed for stored memories
- memory edit/delete admin surfaces
- reaction-driven reinforcement ingestion
- applied-suggestion ingestion
- final investigator/reflection prompt wiring

## Dependencies And Assumptions

- CP6 PH0 admin and ops foundations either already exist or are delivered first where this slice depends on them
- the ops role owns internal writes and durable state transitions
- GitLab note events can be safely expanded without breaking existing `/ai-review` flows
- Mem0 remains behind CodeSmith-owned interfaces; no route or worker should depend directly on provider-specific request shapes

## Design Constraints

1. `/ai-review` remains the highest-priority note trigger and must not regress.
2. Teaching capture only applies to merge-request note events in threads where CodeSmith was explicitly addressed.
3. Same-thread acknowledgment must be idempotent.
4. Route handlers validate and enqueue; they do not perform long-running extraction or persistence inline.
5. CodeSmith must keep provenance records even if the semantic memory substrate changes later.

## Deliverables

### F0 — Contracts & Gating

- Finalized design doc for note eligibility, precedence, and ack behavior
- feature flags for controlled rollout
- docs alignment in the Crown Plan and docs index

### F1 — Webhook Expansion

- schema support for memory-teach notes
- router branching for memory-teach enqueueing
- tests for valid and ignored note paths

### F2 — Queue & Worker Contracts

- new job schema for memory teaching
- worker-core flow for extraction, persistence, and ack publication
- retry/idempotency coverage

### F3 — GitLab Interaction Loop

- surrounding thread fetch support
- same-thread ack posting support
- hidden markers for duplicate suppression

### F4 — Memory Service Boundary

- review-memory interface definitions
- Mem0/PostgreSQL service boundary and provenance registry definition
- config/readiness coverage

### F5 — Prompt Injection Readiness

- documented retrieval contract for later prompt-injection slices
- explicit carry-forward questions for ranking, lifecycle, and admin workflows

## Exit Criteria

This slice is complete when:

1. A qualifying `@code-smith` merge-request note is validated and enqueued without affecting `/ai-review` behavior.
2. The worker can load the thread, decide whether a durable memory should exist, and persist it through CodeSmith-owned interfaces.
3. The bot can post exactly one same-thread acknowledgment reply for each processed teaching event.
4. Retries and duplicate webhook deliveries do not create duplicate memories or duplicate acknowledgments.
5. The retrieval contract for later prompt-injection work is documented and handed off to the next CP3 slice.

## Risks To Watch

- GitLab note payload ambiguity between top-level notes, threaded discussions, and system notes
- over-capturing casual conversation as durable memory
- under-specifying provenance such that later audit or delete flows become difficult
- coupling too much logic to Mem0-specific request shapes too early
- allowing acknowledgment behavior to drift from actual persistence outcomes
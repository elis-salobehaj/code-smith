---
title: "CP7 — Storage Evolution & Advanced Memory Infrastructure"
status: backlog
priority: medium
estimated_hours: 36-60
dependencies:
  - docs/plans/backlog/organizational-learning-plan.md
  - docs/plans/backlog/analytics-observability-plan.md
  - docs/plans/backlog/production-hardening-plan.md
created: 2026-03-22
date_updated: 2026-03-29

related_files:
  - src/config.ts
  - src/ops.ts
  - src/api/pipeline.ts
  - src/learning/store.ts
  - src/learning/mem0-client.ts
  - src/learning/postgres-store.ts
  - src/learning/retrieval.ts
  - src/analytics/store.ts
  - src/analytics/sqlite-store.ts
  - src/analytics/postgres-store.ts
  - docs/context/ARCHITECTURE.md
  - docs/context/CONFIGURATION.md
  - docs/context/WORKFLOWS.md
  - docs/README.md

tags:
  - postgresql
  - pgvector
  - migration
  - storage
  - memory
  - crown-plan
  - CP7

completion:
  - "# Phase S0 — Activation Criteria & Architecture Boundary"
  - [ ] S0.1 Record the revised CP7 mandate: CP3 memory already starts on PostgreSQL plus pgvector, while CP7 governs analytics scale-up and later memory-infrastructure evolution only when thresholds are met
  - [ ] S0.2 Verify CP3 and CP5 store interfaces are backend-agnostic and that Mem0 is isolated behind CodeSmith-owned boundaries before any storage evolution begins
  - [ ] S0.3 Create an ADR describing when to keep Mem0 plus PostgreSQL, when to migrate analytics off SQLite, and when to evaluate dedicated vector or graph memory infrastructure
  - [ ] S0.4 Update crown-plan docs, ARCHITECTURE.md, WORKFLOWS.md, and docs/README.md
  - "# Phase S1 — PostgreSQL Foundation For Analytics & Admin Workloads"
  - [ ] S1.1 Add PostgreSQL analytics configuration and Zod validation to config.ts without changing CP3's direct PostgreSQL memory design
  - [ ] S1.2 Add PostgreSQL connectivity, pooling, migrations, and health checks for ops-owned analytics workloads
  - [ ] S1.3 Implement PostgreSQL analytics and admin-query store adapters while preserving CodeSmith's domain interfaces
  - [ ] S1.4 Port analytics schema, retention state, and admin query surfaces from SQLite to PostgreSQL
  - [ ] S1.5 Add tests for PostgreSQL analytics stores, migrations, rollback safety, and idempotent writes
  - "# Phase S2 — Dual-Write, Backfill & Verification"
  - [ ] S2.1 Add optional analytics dual-write mode in ops consumers (SQLite plus PostgreSQL) while keeping CP3 memory writes unchanged
  - [ ] S2.2 Create backfill tooling from SQLite analytics data into PostgreSQL with checkpoints and retry-safe semantics
  - [ ] S2.3 Add parity verification for counts, hashes, and representative admin queries
  - [ ] S2.4 Add rollback and cutover checklists for analytics reads and writes
  - [ ] S2.5 Add tests for dual-write behavior, backfill idempotency, and parity verification
  - "# Phase S3 — Cutover To PostgreSQL For Analytics & Shared Admin Data"
  - [ ] S3.1 Switch analytics APIs, internal admin reads, and reporting queries to PostgreSQL adapters
  - [ ] S3.2 Disable SQLite analytics writes and retain read-only fallback only for a bounded rollback window
  - [ ] S3.3 Update backup, restore, failover, and runbook guidance for PostgreSQL-backed analytics workloads
  - [ ] S3.4 Revalidate readiness, latency budgets, and queue throughput under the new storage plan
  - [ ] S3.5 Run review-plan-phase audit for storage evolution
  - "# Phase S4 — Advanced Memory Infrastructure Options"
  - [ ] S4.1 Define activation criteria for moving beyond Mem0 plus PostgreSQL plus pgvector, including query latency, memory volume, HA requirements, and model-quality limits
  - [ ] S4.2 Benchmark the existing CP3 memory path and document whether dedicated vector or graph infrastructure is actually justified
  - [ ] S4.3 Evaluate bounded alternatives such as a dedicated vector store or Graphiti-backed temporal memory only if the evidence shows Mem0 plus PostgreSQL is insufficient
  - [ ] S4.4 Add an optional extraction path for a separate memory service or dedicated retrieval backend without changing webhook, queue, or admin contracts
  - [ ] S4.5 Gate any advanced-memory rollout on measured quality improvement, operational cost review, and final audit
---

# CP7 — Storage Evolution & Advanced Memory Infrastructure

## Executive Summary

CP3 no longer starts on SQLite. Review memory is planned directly on Mem0 OSS backed by PostgreSQL plus pgvector because semantic retrieval and first-class memory records are core product requirements, not future nice-to-haves.

CP7 therefore changes scope. It is no longer the plan that migrates learning memory from SQLite to PostgreSQL. Instead, it governs two later-stage evolution paths: first, moving analytics and admin-query workloads off the phase-one SQLite design when the thresholds justify it; second, evaluating whether CodeSmith ever needs memory infrastructure beyond the baseline Mem0 plus PostgreSQL plus pgvector design.

This remains a threshold-driven, additive plan. It exists so analytics storage and future memory infrastructure can evolve without forcing queue-payload, webhook, prompt-injection, or admin-contract rewrites.

## Activation Criteria

Do not start CP7 just because PostgreSQL or a graph backend looks more sophisticated. Start it only when at least one of the following becomes true:

- analytics or admin-query workloads create sustained queue lag or unacceptable maintenance windows on the phase-one SQLite path
- operator, BI, or external reporting consumers need richer SQL access, replication, or stronger recovery guarantees than file-based workflows allow
- analytics retention size grows into multi-GB territory and bounded admin queries degrade despite indexes and pruning
- the ops role needs stronger HA or maintenance characteristics than the singleton SQLite design can safely provide for analytics and admin facts
- the Mem0 plus PostgreSQL plus pgvector memory path shows clear limits in latency, retrieval quality, lifecycle flexibility, or operational isolation
- a dedicated vector or graph memory system is justified by measured product quality, not by architectural curiosity

If none of those conditions are true, keep the current CP3 and CP5 storage choices and do not spend the migration cost yet.

## Technology Decisions

| Concern | Choice | Rationale |
|---|---|---|
| Memory baseline | Mem0 OSS on PostgreSQL plus `pgvector` | CP3 requires semantic memory from day one, so this is now the starting point rather than the migration target |
| Analytics scale-up relational store | PostgreSQL | Best long-term system of record for concurrency, replication, PITR, and external SQL/reporting |
| Advanced memory alternatives | Dedicated vector DB or temporal graph only when proven necessary | Avoids overbuilding until Mem0 plus PostgreSQL plus pgvector is shown to be insufficient |
| Migration style | Additive and threshold-driven | Avoids rewriting CP3/CP5 and lets each subsystem evolve only under real pressure |
| Queue contracts | Remain DB-neutral | Producers should not care whether ops writes to SQLite or PostgreSQL |
| Rollout safety | Dual-write, backfill, parity verification, controlled cutover | Reduces migration blast radius and preserves rollback options |
| Dedicated vector DBs and graph memory | Deferred | Qdrant, Weaviate, or Graphiti should be evaluated only if the baseline memory design proves insufficient |

## Architecture Target

### Phase-One State

- CP3 learning memory uses Mem0 OSS on PostgreSQL plus `pgvector`
- SQLite remains the phase-one store for analytics and some admin-reporting facts owned by the ops role
- Valkey handles BullMQ job transport and cache duties
- Workers read memories and analytics-derived state through internal read-only service contracts

### Post-Migration State

- PostgreSQL becomes the system of record for analytics and shared admin-query workloads as well
- Valkey remains queue/cache infrastructure only
- Mem0 plus PostgreSQL plus `pgvector` remains the default memory baseline unless later evidence justifies a more specialized retrieval backend
- Queue producers, route contracts, and review-worker consumers keep the same domain-level interfaces

## Migration Principles

1. Do not change producer payloads just because the backend changes.
2. Do not couple route handlers to SQL engine details.
3. Keep learning and analytics behind repository/query interfaces.
4. Do not re-open CP3's direct PostgreSQL plus pgvector decision unless measured evidence justifies it.
5. Prove value before adding a dedicated vector or graph system on top of the baseline memory path.

## Phased Implementation

### Phase S0 — Activation Criteria & Architecture Boundary

**Goal:** Confirm the revised CP7 scope is justified and the codebase has the right seams before any further storage evolution begins.

**S0.1** — Record the revised mandate:
- Document that CP3 already starts with Mem0 plus PostgreSQL plus pgvector
- Narrow CP7 to analytics scale-up and advanced-memory evolution only
- Remove stale wording that implies CP7 is the gateway to semantic memory

**S0.2** — Verify interfaces and boundaries:
- Confirm CP3 memory code depends on CodeSmith-owned interfaces rather than raw Mem0 calls scattered through the codebase
- Confirm CP5 analytics code depends on backend-agnostic store interfaces rather than direct SQLite calls in handlers or queue consumers

**S0.3** — Create ADR:
- Record the baseline memory architecture
- Record PostgreSQL as the default analytics scale-up target
- Record dedicated vector DBs and graph memory as future evaluation scope only

**S0.4** — Update docs:
- Add the activation criteria above to docs and the runbook
- Require a short evidence note before CP7 starts

### Phase S1 — PostgreSQL Foundation For Analytics & Admin Workloads

**Goal:** Add PostgreSQL support for analytics and shared admin workloads without changing CP3's baseline memory behavior.

**S1.1** — Config and validation:
- Add PostgreSQL analytics env vars to `src/config.ts` with Zod validation
- Keep the config model explicit about which settings apply to analytics/admin storage versus the CP3 memory substrate

**S1.2** — Connectivity and health:
- Add PostgreSQL connectivity and pooling for the ops role
- Extend readiness diagnostics for analytics/admin relational health without leaking secrets

**S1.3** — Store adapters:
- Implement PostgreSQL versions of the CP5 analytics and admin-query store interfaces
- Keep public interfaces unchanged from the SQLite adapters

**S1.4** — Schema and migrations:
- Port analytics tables, admin-query support tables, retention state, and reporting indexes from SQLite to PostgreSQL
- Preserve uniqueness, idempotency, and transactional guarantees from the SQLite design

**S1.5** — Tests:
- Migration tests
- CRUD and query tests against PostgreSQL analytics adapters
- Idempotent queue-consumer write tests
- Error-path tests for connectivity loss and transaction rollback

### Phase S2 — Dual-Write, Backfill & Verification

**Goal:** Prove parity before cutover for analytics and admin data.

**S2.1** — Dual-write mode:
- Add an ops-only feature flag that writes analytics/admin data to both SQLite and PostgreSQL from the same validated job payloads
- CP3 memory writes remain on their existing path during this phase

**S2.2** — Backfill:
- Create a one-shot or resumable backfill tool that copies existing SQLite analytics and admin data into PostgreSQL
- Include batching, checkpoints, and retry-safe semantics

**S2.3** — Parity verification:
- Verify row counts, uniqueness expectations, and representative admin queries between stores
- Produce a parity report before cutover

**S2.4** — Rollback checklist:
- Document how to revert reads to SQLite if parity or stability checks fail after partial rollout

**S2.5** — Tests:
- Dual-write correctness
- Backfill idempotency
- Parity verification for key tables and aggregate queries

### Phase S3 — Cutover To PostgreSQL For Analytics & Shared Admin Data

**Goal:** Move analytics and shared admin data to PostgreSQL safely.

**S3.1** — Cut over reads:
- Switch analytics APIs, internal admin reads, and reporting queries to PostgreSQL adapters

**S3.2** — Cut over writes:
- Disable SQLite as the authoritative analytics writer
- Keep SQLite read-only fallback for a bounded rollback window if operationally useful

**S3.3** — Operational docs:
- Update backup, restore, failover, and maintenance procedures for PostgreSQL-backed analytics
- Update dashboards and alerts to include relational metrics and migration-specific failure cases

**S3.4** — Performance and readiness:
- Revalidate readiness rules, latency budgets, and queue throughput under PostgreSQL

**S3.5** — Audit:
- Run `review-plan-phase` and do not declare cutover complete until parity, rollback, and docs are all verified

### Phase S4 — Advanced Memory Infrastructure Options

**Goal:** Evaluate more specialized memory infrastructure only if the baseline Mem0 plus PostgreSQL plus pgvector path proves insufficient.

**S4.1** — Confirm the use case:
- Document the exact deficiency in the baseline memory stack
- Examples: unacceptable latency at scale, inadequate temporal reasoning, hard provenance needs, or memory-isolation constraints that Mem0 plus PostgreSQL cannot satisfy cleanly

**S4.2** — Benchmark the baseline:
- Measure memory query latency, result quality, usage growth, and operator burden on the existing CP3 path
- Record evidence before evaluating new infrastructure

**S4.3** — Evaluate alternatives:
- Compare bounded options such as a dedicated vector store or Graphiti-backed temporal memory only if evidence shows the baseline is insufficient
- Require explicit tradeoff analysis for every new dependency and service added

**S4.4** — Optional extraction path:
- Add a path to extract memory retrieval into a dedicated internal service or backend without changing webhook, queue, or admin contracts

**S4.5** — Release gate:
- Do not enable advanced memory infrastructure in production without measured quality improvement and an explicit cost and operability sign-off

## Out Of Scope

- Replacing Valkey as queue/cache infrastructure
- Re-arguing CP3's decision to start memory on Mem0 plus PostgreSQL plus pgvector without new evidence
- Adding Qdrant, Weaviate, Graphiti, or another specialized memory backend by default

## Success Criteria

CP7 is complete when:

1. Analytics and shared admin data can move off SQLite without changing queue-producer payloads or route contracts
2. Backfill and dual-write verification prove parity before cutover
3. Operational docs cover PostgreSQL backup, restore, and recovery for the evolved storage path
4. CP3's baseline memory stack remains stable unless evidence justifies a more specialized memory backend
5. Any advanced memory-infrastructure rollout is backed by measured quality improvement and acceptable operational cost
4. Treat `pgvector` as optional scope, not a mandatory part of the relational migration.
5. Prove value before adding embedding generation cost to the review system.

## Phased Implementation

### Phase M0 — Activation Criteria & Architecture Boundary

**Goal:** Confirm the migration is justified and the codebase has the right seam.

**M0.1** — Record activation criteria:
- Add the activation criteria above to docs and the runbook
- Require a short evidence note before CP7 starts (load, latency, recovery, reporting, or semantic-quality pressure)

**M0.2** — Verify storage interfaces from CP3/CP5:
- Confirm learning and analytics use store/query interfaces rather than direct SQLite calls across the codebase
- If direct SQLite calls leaked into handlers or queue consumers, remediate that before any PostgreSQL work starts

**M0.3** — Create ADR:
- PostgreSQL is the default relational scale-up target
- `pgvector` is optional and only activated by demonstrated semantic retrieval need
- Dedicated vector DBs remain future evaluation scope, not default scope

**M0.4** — Update ARCHITECTURE.md, WORKFLOWS.md, and docs/README.md

### Phase M1 — PostgreSQL Foundation

**Goal:** Add PostgreSQL support without changing the system's external behavior.

**M1.1** — Config and validation:
- Add PostgreSQL env vars to `src/config.ts` with Zod validation
- Example: `POSTGRES_ENABLED`, `POSTGRES_URL`, optional SSL settings, pool sizing, and migration toggles

**M1.2** — Connectivity and health:
- Add PostgreSQL connectivity module for the ops role
- Extend readiness diagnostics for ops to report relational-backend health without leaking secrets

**M1.3** — Store adapters:
- Implement PostgreSQL versions of the CP3/CP5 store interfaces
- Keep public interfaces unchanged from the SQLite adapters

**M1.4** — Schema and migrations:
- Port feedback events, learned patterns, review runs, review findings, sync cursors, and retention logic to PostgreSQL
- Preserve uniqueness, idempotency, and transactional guarantees from the SQLite design

**M1.5** — Tests:
- Migration tests
- CRUD and query tests against PostgreSQL adapters
- Idempotent queue-consumer write tests
- Error-path tests for connectivity loss and transaction rollback

### Phase M2 — Dual-Write, Backfill & Verification

**Goal:** Prove parity before cutover.

**M2.1** — Dual-write mode:
- Add an ops-only feature flag that writes both SQLite and PostgreSQL from the same validated job payloads
- Reads continue to come from SQLite during this phase

**M2.2** — Backfill:
- Create a one-shot or resumable backfill tool that copies existing SQLite learning and analytics data into PostgreSQL
- Include batching, checkpoints, and retry-safe semantics

**M2.3** — Parity verification:
- Verify row counts, uniqueness expectations, and selected sample queries between stores
- Produce a parity report before cutover

**M2.4** — Rollback checklist:
- Document how to revert reads to SQLite if parity or stability checks fail after partial rollout

**M2.5** — Tests:
- Dual-write correctness
- Backfill idempotency
- Parity verification for key tables and aggregate queries

### Phase M3 — Cutover To PostgreSQL System Of Record

**Goal:** Move reads and writes to PostgreSQL safely.

**M3.1** — Cut over reads:
- Switch admin APIs, internal read-only learning endpoints, and analytics query services to PostgreSQL adapters

**M3.2** — Cut over writes:
- Disable SQLite as the authoritative writer
- Keep SQLite read-only fallback for a bounded rollback window if operationally useful

**M3.3** — Operational docs:
- Update backup, restore, failover, and maintenance procedures for PostgreSQL
- Update dashboards and alerts to include relational metrics and migration-specific failure cases

**M3.4** — Performance and readiness:
- Revalidate readiness rules, latency budgets, and queue throughput under PostgreSQL

**M3.5** — Audit:
- Run `review-plan-phase` and do not declare cutover complete until parity, rollback, and docs are all verified

### Phase M4 — Optional pgvector Semantic Retrieval

**Goal:** Add vector retrieval only if the product has proven it needs it.

**M4.1** — Confirm the use case:
- Document the exact semantic retrieval need
- Examples: retrieving similar past feedback from free-form comment text, fuzzy policy memory, or cross-project analog retrieval that heuristics cannot cover well

**M4.2** — Enable `pgvector`:
- Install and enable the extension in PostgreSQL
- Add embedding tables and indexes behind a separate retrieval abstraction

**M4.3** — Embedding pipeline:
- Define which texts are embedded
- Bound token cost, batch sizes, retry behavior, and model/version tracking
- Keep embedding generation out of latency-critical review paths where possible

**M4.4** — Hybrid retrieval evaluation:
- Compare heuristic-only learning against heuristic plus embedding retrieval on real Code Smith feedback history
- Measure quality lift, latency impact, storage size, and operational cost

**M4.5** — Release gate:
- Do not enable semantic retrieval in production without measured quality improvement and an explicit cost/operability sign-off

## Out Of Scope

- Replacing Valkey as queue/cache infrastructure
- Adding Qdrant or another dedicated vector database by default
- General-purpose conversational memory frameworks such as Mem0 as a replacement for Code Smith's auditable feedback-learning model

## Success Criteria

CP7 is complete when:

1. PostgreSQL can replace SQLite without changing queue-producer payloads or route contracts
2. Backfill and dual-write verification prove parity before cutover
3. Operational docs cover PostgreSQL backup, restore, and recovery
4. `pgvector` remains optional unless semantic retrieval was explicitly justified and validated
5. The resulting architecture is simpler to operate than a split relational-plus-dedicated-vector design unless proven otherwise
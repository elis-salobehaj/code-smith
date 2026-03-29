---
title: "CP7 — PostgreSQL & pgvector Migration Path"
status: backlog
priority: medium
estimated_hours: 40-70
dependencies:
  - docs/plans/backlog/organizational-learning-plan.md
  - docs/plans/backlog/analytics-observability-plan.md
  - docs/plans/backlog/production-hardening-plan.md
created: 2026-03-22
date_updated: 2026-03-22

related_files:
  - src/config.ts
  - src/ops.ts
  - src/api/pipeline.ts
  - src/agents/state.ts
  - src/learning/store.ts
  - src/learning/sqlite-store.ts
  - src/analytics/store.ts
  - src/analytics/sqlite-store.ts
  - docs/context/ARCHITECTURE.md
  - docs/context/CONFIGURATION.md
  - docs/context/WORKFLOWS.md
  - docs/README.md

tags:
  - postgresql
  - pgvector
  - migration
  - storage
  - crown-plan
  - CP7

completion:
  - "# Phase M0 — Activation Criteria & Architecture Boundary"
  - [ ] M0.1 Record activation criteria for leaving SQLite phase-one storage
  - [ ] M0.2 Verify CP3/CP5 storage interfaces exist and are SQLite-agnostic
  - [ ] M0.3 Create ADR naming PostgreSQL as default scale-up target and pgvector as optional semantic extension
  - [ ] M0.4 Update crown-plan docs and architecture docs
  - "# Phase M1 — PostgreSQL Foundation"
  - [ ] M1.1 Add PostgreSQL configuration and Zod validation to config.ts
  - [ ] M1.2 Add PostgreSQL connectivity module and health checks for ops role
  - [ ] M1.3 Implement PostgreSQL learning and analytics store adapters
  - [ ] M1.4 Port schema and migrations from SQLite to PostgreSQL
  - [ ] M1.5 Add tests for PostgreSQL stores, migrations, and idempotent writes
  - "# Phase M2 — Dual-Write, Backfill & Verification"
  - [ ] M2.1 Add optional dual-write mode in ops consumers (SQLite + PostgreSQL)
  - [ ] M2.2 Create backfill tooling from SQLite to PostgreSQL
  - [ ] M2.3 Add parity verification for counts, hashes, and sample query outputs
  - [ ] M2.4 Add rollback plan and cutover gate checklist
  - [ ] M2.5 Add tests for backfill and parity verification
  - "# Phase M3 — Cutover To PostgreSQL System Of Record"
  - [ ] M3.1 Switch read paths and admin APIs to PostgreSQL adapters
  - [ ] M3.2 Disable SQLite writes and retain read-only fallback for rollback window
  - [ ] M3.3 Update backup, restore, and operational runbooks for PostgreSQL
  - [ ] M3.4 Update performance, readiness, and dashboard docs
  - [ ] M3.5 Run review-plan-phase audit for relational migration
  - "# Phase M4 — Optional pgvector Semantic Retrieval"
  - [ ] M4.1 Confirm semantic retrieval is actually required beyond heuristic learning
  - [ ] M4.2 Enable pgvector extension and create embedding storage schema
  - [ ] M4.3 Add embedding generation/backfill pipeline with bounded cost controls
  - [ ] M4.4 Add hybrid retrieval evaluation against heuristic-only baseline
  - [ ] M4.5 Gate production rollout on measured quality improvement and operational cost review
---

# CP7 — PostgreSQL & pgvector Migration Path

## Executive Summary

CP3 and CP5 intentionally start with `bun:sqlite` because it is Bun-native, cheap to ship, and acceptable when writes are isolated to a singleton ops service on safe block-backed storage. That is the correct phase-one tradeoff.

This plan exists so SQLite does not become an accidental forever-dependency.

CP7 defines the threshold-driven migration path to PostgreSQL as the long-term system of record for organizational learning and analytics, with `pgvector` reserved as an optional extension only if Code Smith later proves it needs semantic retrieval over free-form review memory. This is not a big-bang rewrite plan. It is an additive migration plan that assumes CP3 and CP5 were implemented behind storage interfaces.

## Activation Criteria

Do not start CP7 just because PostgreSQL is more powerful. Start it only when at least one of the following becomes true:

- the ops role needs HA beyond a singleton writer and queue-based downtime tolerance
- operator or BI consumers need direct SQL access or richer external reporting
- analytics or learning writes create sustained queue lag or unacceptable maintenance windows
- the SQLite database grows into multi-GB or tens-of-GB territory and admin queries degrade despite indexes and bounded windows
- backup and recovery expectations exceed file-copy plus restore workflows
- semantic retrieval across free-form feedback text or review corpora becomes a real product requirement that heuristic pattern extraction cannot satisfy

If none of those conditions are true, keep SQLite and do not spend the migration cost yet.

## Technology Decisions

| Concern | Choice | Rationale |
|---|---|---|
| Default scale-up relational store | PostgreSQL | Best long-term system of record for concurrency, replication, PITR, and external SQL/reporting |
| Vector extension | `pgvector` only when needed | Keeps transactional and semantic memory in one operational plane instead of adding a dedicated vector service immediately |
| Migration style | Additive and threshold-driven | Avoids rewriting CP3/CP5 and allows SQLite to remain phase-one storage until pressure is real |
| Queue contracts | Remain DB-neutral | Producers should not care whether ops writes to SQLite or PostgreSQL |
| Rollout safety | Dual-write, backfill, parity verification, controlled cutover | Reduces migration blast radius and preserves rollback options |
| Dedicated vector DBs | Deferred | Qdrant or similar should be evaluated only if pgvector proves operationally or performance-wise insufficient |

## Architecture Target

### Phase-One State

- SQLite is the relational system of record for learning and analytics
- Valkey handles BullMQ job transport and cache duties
- Workers read learned patterns through an internal read-only service contract

### Post-Migration State

- PostgreSQL becomes the relational system of record for learning, analytics, and admin CRUD
- Valkey remains queue/cache infrastructure only
- `pgvector` is enabled only if semantic retrieval is approved by activation criteria and quality evaluation
- Queue producers, route contracts, and review-worker consumers keep the same domain-level interfaces

## Migration Principles

1. Do not change producer payloads just because the backend changes.
2. Do not couple route handlers to SQL engine details.
3. Keep learning and analytics behind repository/query interfaces.
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
# Plan Review: Crown Plan Storage Architecture (Post-Remediation Re-review)

**Plan file**: `docs/plans/active/git-gandalf-crown-plan.md`
**Reviewed child plans**:
- `docs/plans/backlog/organizational-learning-plan.md`
- `docs/plans/backlog/analytics-observability-plan.md`
- `docs/plans/backlog/production-hardening-plan.md`
- `docs/plans/backlog/postgresql-pgvector-migration-plan.md`
**Reviewed against**: `AGENTS.md`, `docs/context/ARCHITECTURE.md`, `docs/context/WORKFLOWS.md`, `docs/context/CONFIGURATION.md`, active plans, current source code
**Verdict**: 🟢 READY

## Summary

The storage review findings have been remediated cleanly.

The plan set now treats SQLite as a bounded phase-one implementation choice rather than a permanent architectural commitment. The operational guardrails are explicit: a singleton ops writer, durable BullMQ write transport, block-backed `ReadWriteOnce` storage only, and a separate internal read-only path for workers. Just as important, CP3 and CP5 now require storage contracts so PostgreSQL can replace SQLite later without rewriting queue payloads, admin route contracts, or prompt-injection logic.

CP7 also gives the plan set a concrete, non-invasive future path. PostgreSQL is now the named long-term relational target, and `pgvector` is reserved for a later semantic-retrieval phase only if the product actually proves that need.

**Findings**: 0 BLOCKER · 0 RISK · 0 OPTIMIZATION

---

## BLOCKERs

None.

---

## RISKs

None.

---

## OPTIMIZATIONs

None.

---

## Confirmed Remediations

1. SQLite deployment semantics are now explicit across the Crown Plan, CP3, and CP6: phase-one support is limited to a singleton ops deployment on block-backed `ReadWriteOnce` storage, with shared RWX or generic network-filesystem mounts explicitly unsupported for the SQLite file.
2. The storage migration seam now exists at the plan level: CP3 and CP5 both require DB-neutral store contracts, and CP7 is the formal threshold-driven migration path instead of an implied future rewrite.
3. Storage roles are now separated clearly: relational storage is the source of truth, Valkey remains queue/cache infrastructure, and vector indexing is optional future scope only.
4. The future path is directionally correct and proportionate: PostgreSQL is the named scale-up target, while `pgvector` is deferred until semantic retrieval is justified by measured product need.
5. The agent-facing docs now reflect this architecture boundary so implementation work is less likely to drift back toward direct SQLite coupling or admin-surface credential reuse.

## Verdict Details

This storage architecture is now **READY** for implementation as planned.

The key tradeoff remains the right one:

- ship with SQLite first because it is Bun-native and cheap to operate in the bounded singleton-ops design
- preserve PostgreSQL as the long-term relational target rather than pretending phase-one storage is forever
- keep `pgvector` optional so semantic infrastructure is added only after a real retrieval problem exists

That is the correct balance between short-term delivery cost and long-term architectural discipline.

> This report supersedes the earlier conditional storage review for 2026-03-22.
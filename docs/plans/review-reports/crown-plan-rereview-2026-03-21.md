## Plan Review: Crown Plan Follow-Up Re-Review

**Plan files**:
- `docs/plans/active/code-smith-crown-plan.md`
- `docs/plans/implemented/repo-review-config-plan.md`
- `docs/plans/backlog/linter-sast-integration-plan.md`
- `docs/plans/backlog/organizational-learning-plan.md`
- `docs/plans/backlog/enhanced-review-output-plan.md`
- `docs/plans/backlog/analytics-observability-plan.md`
- `docs/plans/backlog/production-hardening-plan.md`

**Reviewed against**: `AGENTS.md`, `docs/context/ARCHITECTURE.md`, `docs/context/WORKFLOWS.md`, `docs/README.md`, `package.json`, `src/api/router.ts`, `src/api/pipeline.ts`, `src/config.ts`, `src/gitlab-client/client.ts`

**Verdict**: 🟡 CONDITIONAL

### Summary

The plan set is materially stronger than the previous revision. The earlier blockers are resolved: repo-defined linter commands are gone, `npx eslint` is no longer assumed, dedicated admin/auth surfaces were added, and SQLite ownership is now explicitly singleton-oriented instead of hand-waved as a shared-PVC solution.

The remaining issues are not fundamental architecture failures, but they are still real implementation risks. They cluster around incomplete integration seams: the singleton ops service exists in prose, but the plan still does not fully specify how write traffic reaches it, how feedback cursors are persisted, how standalone linter binaries are sandboxed, and how readiness semantics differ across webhook, worker, and ops roles.

**Findings**: 0 BLOCKER · 4 RISK · 2 OPTIMIZATION

---

### Dependency Audit

`bun audit` was rerun during this review.

Current output:

```text
bun audit v1.3.11
fast-xml-parser >=4.0.0-beta.3 <=5.5.6
  @aws-sdk/client-bedrock-runtime › @aws-sdk/core › @aws-sdk/xml-builder › fast-xml-parser
  moderate: Entity Expansion Limits Bypassed When Set to Zero Due to JavaScript Falsy Evaluation in fast-xml-parser
  high: fast-xml-parser affected by numeric entity expansion bypassing all entity expansion limits

2 vulnerabilities (1 high, 1 moderate)
```

This is no longer a new plan-design blocker because CP6 now contains an explicit dependency-audit gate, but the underlying repo vulnerability remains unresolved and should stay visible during implementation sequencing.

---

### RISKs

#### R1: Singleton Ops Ownership Still Lacks A Concrete Write Transport
- **Dimension**: Architecture
- **Finding**: The revised plans correctly move learning and analytics writes to a singleton ops service, but they still do not define the transport contract that gets write intents from webhook and worker pods into that service. CP3 defines only a read-side `LearningClient`, while CP5 says pipeline completion should route analytics writes through the singleton ops service "or its write-owned database module." That leaves the write path underspecified.
- **Impact**: Implementers will be forced to invent the seam during implementation. That is likely to produce one of two bad outcomes: either non-ops pods start writing directly to SQLite again, or the system grows an ad-hoc synchronous RPC path with unclear retry, timeout, and idempotency behavior.
- **Alternative**: Add an explicit PH0/OL0 contract for write traffic. Prefer a durable internal queue already consistent with the repo's BullMQ/Valkey pattern, or define a single authenticated internal RPC surface with bounded retries, idempotency keys, and a documented failure policy. Name the transport, the producer, the consumer, and the backpressure behavior in the plan.

#### R2: Cursor-Based Feedback Sync Has No Persisted Sync-State Model
- **Dimension**: Resilience
- **Finding**: OL2.4 now correctly requires per-MR cursors and idempotent resume, but OL1's schema still defines only `feedback_events`, `learned_patterns`, and `review_runs`. There is no `feedback_sync_state` table, no persisted cursor model, and no event-source identifiers for note/discussion/reaction reconciliation.
- **Impact**: A restart or partial failure will force implementers to guess how to resume polling. That invites broad rescans, duplicate feedback ingestion, and inconsistent handling of edits, removed reactions, or partial sync progress.
- **Alternative**: Extend OL1 with a dedicated sync-state schema. At minimum, add a `feedback_sync_state` table keyed by project/MR/source, persist last cursor or watermark per source, and store enough source identifiers in `feedback_events` to deduplicate and reconcile re-polls deterministically.

#### R3: Standalone Linter Profiles Still Need An Explicit Sandbox Contract
- **Dimension**: Security
- **Finding**: CP2 is much safer now that repo-defined commands are gone, but the plan still executes operator-installed standalone binaries directly against cloned repositories with only allowlisting, timeout, and graceful failure requirements. It does not specify environment scrubbing, secret isolation, output caps, temp-dir isolation, or whether these binaries inherit ambient network and credential access.
- **Impact**: The risk moved from repo-authored arbitrary execution to operator-enabled execution on untrusted repository content. A vulnerable or compromised standalone tool could still read sensitive environment variables, emit unbounded output, or amplify resource exhaustion.
- **Alternative**: Add a mandatory execution contract for all standalone profiles. Specify minimal inherited environment, explicit removal of GitLab/Jira/LLM credentials, stdout/stderr byte caps, timeout plus kill behavior, isolated temp storage, and whether network access is allowed or denied. If full sandboxing is deferred, state the exact compensating controls required for phase 1.

#### R4: Readiness Semantics Are Corrected Conceptually But Still Not Split By Deployment Role
- **Dimension**: Structure
- **Finding**: CP6 now correctly says readiness should not depend on GitLab reachability, but PH2.1 still describes a single `/readyz` behavior that includes database accessibility checks even though webhook and worker pods no longer mount the learning database by default. The plan has three roles now: webhook, worker, and singleton ops. Their readiness contracts are not separated.
- **Impact**: Implementers may copy one generic readiness handler across all pods and either over-check dependencies on the wrong role or make healthy pods flap because they probe dependencies they do not own.
- **Alternative**: Add a role-specific probe matrix in PH1/PH2. Webhook readiness should cover config and enqueue path when queue mode is enabled. Worker readiness should cover config, queue connectivity, and local runtime state. Ops readiness should cover config, SQLite accessibility, scheduler health, and admin-route availability. Keep external service reachability on diagnostics only.

---

### OPTIMIZATIONs

#### O1: The Docs Index Still Describes Superseded Plan Scope
- **Dimension**: Structure
- **Finding**: `docs/README.md` still describes CP2 as "Biome/ESLint" and describes CP3 without the new admin/control-plane ownership nuance. That conflicts with the revised plan set and will mislead later implementers who rely on the docs index as the plan map.
- **Impact**: The plan set and the docs index can diverge again during implementation, causing agents or humans to pick up outdated scope assumptions.
- **Alternative**: Update `docs/README.md` immediately after accepting this report so the backlog summaries match the revised plan language: Biome plus instance-owned standalone profiles, singleton ops ownership, and admin-route protection.

#### O2: The Production Deployment Diagram Has Not Caught Up To The New Ops Split
- **Dimension**: Structure
- **Finding**: CP6's deployment prose now depends on a singleton ops deployment, but the target deployment diagram still only visualizes webhook pods, workers, Valkey, GitLab, and Prometheus. The admin/ops service is absent from the main architecture picture.
- **Impact**: The written design and the visual design are now slightly out of sync. That is survivable, but it weakens the plan as an implementation handoff artifact.
- **Alternative**: Update the CP6 deployment diagram and, if helpful, the Crown Plan dependency graph so the webhook, worker, and ops/control-plane roles are all shown explicitly.

---

### Verdict

The updated plan set is no longer in the previous "do not start" state. The major architectural and security blockers from the first review have been addressed.

Implementation should still not begin blind. Resolve the four residual risks first, or explicitly accept them in the governing plan files with the missing transport, sync-state, sandbox, and role-specific readiness contracts filled in. Once those seams are locked down, the plan set should be ready to implement.
# Plan Review: The Crown Plan — Git Gandalf Feature Parity & Beyond (Re-review)

**Plan file**: `docs/plans/active/git-gandalf-crown-plan.md` + attached child plans CP1–CP6
**Reviewed against**: AGENTS.md, docs/agents/context/ARCHITECTURE.md, docs/agents/context/WORKFLOWS.md, active plans, current source code
**Verdict**: 🟡 CONDITIONAL

## Summary

The updated Crown Plan set is materially stronger than the previous revision. The stale scoring, ops-entrypoint ambiguity, polling bounds, PH0/OL0 duplication, backup gap, HPA caveat, and several implementation-quality optimizations were all addressed in a meaningful way. The remaining issues are narrower: one compliance regression in the dependency-audit workflow, one still-ambiguous auth boundary between operator-admin surfaces and worker read paths, and two structural ambiguities that should be cleaned up before implementation to avoid unnecessary design drift.

**Findings**: 0 BLOCKER · 2 RISK · 2 OPTIMIZATION

---

## RISKs

### R1: PH0.3 regresses from Bun-only workflow into `npx` / `npm` despite `bun audit` working
- **Dimension**: Structure
- **Finding**: The Crown Plan still locks dependency phases to a `bun audit` gate, and CP6's operating assumptions repeat that requirement. But CP6 PH0.3 now instructs implementers to use `npx audit-ci --moderate`, with fallback to `npm audit --omit=dev`. That conflicts directly with AGENTS.md's Bun-only rule and is no longer justified by tooling limitations: in the current repo, `bun audit` now works and reports real advisories.
- **Evidence**:
  - Crown Plan lock: `bun audit` requirement in `docs/plans/active/git-gandalf-crown-plan.md`
  - CP6 operating assumption: `bun audit` requirement in `docs/plans/backlog/production-hardening-plan.md`
  - Conflicting PH0.3 command: `npx audit-ci` / `npm audit` in `docs/plans/backlog/production-hardening-plan.md`
  - Actual terminal result from this review: `bun audit` reported 2 advisories in `fast-xml-parser` via `@aws-sdk/client-bedrock-runtime` (1 high, 1 moderate)
- **Impact**: Implementers are given contradictory process guidance and may violate repo rules by introducing `npx`/`npm` into CI or local workflows. It also weakens the plan's credibility because the fallback is based on an obsolete assumption that Bun audit is unavailable.
- **Alternative**: Make `bun audit` the canonical required gate everywhere. If a policy wrapper is still desired, use `bunx audit-ci` only as an optional secondary CI formatter, not the primary requirement. PH0.3 should also explicitly capture the current baseline advisories and require accepted-risk tracking or remediation before adding more dependency surface.

### R2: Worker read-path auth is still entangled with the operator admin surface
- **Dimension**: Security
- **Finding**: CP3 now correctly avoids direct SQLite reads and routes worker reads through `LearningClient`, but the plan still points that read path at the same admin/control-plane surface used for operator endpoints. OL0.1 and OL5 define `/api/v1/admin/learning/*` for management, while OL0.3 and OL4.1 say workers fetch active patterns through the dedicated admin/control-plane route group. CP6 PH0.1 defines that surface as protected by a dedicated bearer token or mTLS. As written, either workers need the full admin credential, or the same surface has to multiplex both privileged operator writes and routine worker reads.
- **Impact**: This expands blast radius unnecessarily. A compromised worker pod could inherit a credential that also authorizes pattern mutation, analytics access, or other admin-only routes. Even if implementers intend path-based restrictions later, the plan currently leaves the trust boundary ambiguous.
- **Alternative**: Split the surfaces explicitly. Keep `/api/v1/admin/*` for operator-only read/write management routes. Add a separate internal read-only endpoint or service contract for worker consumption, for example `/api/v1/internal/learning/patterns` or an ops-internal RPC surface, authenticated with service identity or a distinct read-only credential. State clearly that worker pods must never receive the operator admin bearer token.

---

## OPTIMIZATIONs

### O1: CP5 still has unclear ownership of the Prometheus foundation relative to CP6
- **Dimension**: Structure
- **Finding**: The Crown Plan says CP5 depends on CP6 for the Prometheus metrics foundation, and CP5's executive summary says CP6 establishes the metrics library and endpoint. But CP5 A1 still creates the metrics registry, defines metrics, and adds the `/metrics` route itself. CP6, meanwhile, describes metrics as part of its capabilities but does not contain the concrete implementation tasks for that foundation.
- **Impact**: This is no longer dangerous, but ownership is still blurred. Two implementers could both assume the other plan owns `src/metrics/*` and `/metrics`, or they could both build overlapping pieces.
- **Alternative**: Pick one owner and state it plainly. The cleaner split is: CP5 owns `src/metrics/*`, `/metrics`, and instrumentation; CP6 consumes those outputs for deployment, scrape config, runbooks, and scaling follow-ons. If CP6 must own the foundation, move concrete registry/endpoint tasks into CP6 and reduce CP5 A1 to instrumentation only.

### O2: CP4 still contains two competing walkthrough architectures
- **Dimension**: Architecture
- **Finding**: RO2.1 now includes the good optimization note that walkthroughs may be produced by extending the context agent, but RO2.4 still states that walkthroughs use a separate focused LLM call outside the main review pipeline. Those two statements describe different architectures with different cost and latency behavior.
- **Impact**: Implementers still have to choose the real design during implementation, which re-opens the very ambiguity the optimization was meant to remove.
- **Alternative**: Decide now. Either: (a) make walkthrough generation an extension of the context-agent output and update RO2.4's token-budget section accordingly, or (b) keep the separate call as the approved design and remove the context-agent alternative from RO2.1. Leaving both in the plan invites drift.

---

## Confirmed Strengths

1. The score corrections and baseline narrative in the Crown Plan are now aligned with the evaluation document.
2. The ops role is now concrete enough to implement: `src/ops.ts`, `DEPLOYMENT_ROLE`, queue names, and shutdown behavior are specified.
3. CP3's polling design is now bounded in a production-reasonable way instead of assuming unbounded 5-minute scans.
4. PH0/OL0 ownership is substantially cleaner: CP6 creates the foundation, CP3 consumes it.
5. The migration runner now requires transactions, which closes an important schema-corruption edge case at essentially zero complexity cost.
6. The production-hardening plan now acknowledges both backup/recovery requirements and the limits of CPU-based worker autoscaling.
7. The active-plan coordination note with Gandalf Awakening is now explicit and useful.

## Verdict Details

This re-review is still **CONDITIONAL**, but the remaining work is much smaller than before.

**Should resolve before implementation starts:**
- **R1**: normalize the dependency-audit workflow back to Bun-native commands and capture the current audit baseline
- **R2**: split worker read access from operator-admin credentials/routes

**Can be resolved during final plan cleanup before handoff:**
- **O1**: clarify whether CP5 or CP6 owns the concrete metrics foundation
- **O2**: choose one walkthrough architecture and remove the competing alternative

No blockers remain. If the two residual risks are fixed, the Crown Plan set is ready for implementation.
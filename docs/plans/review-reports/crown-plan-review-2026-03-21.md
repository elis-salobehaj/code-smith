# Plan Review: The Crown Plan — Git Gandalf Feature Parity & Beyond

**Plan file**: `docs/plans/active/git-gandalf-crown-plan.md` + all six child plans (CP1–CP6)
**Reviewed against**: AGENTS.md, docs/context/ARCHITECTURE.md, docs/context/WORKFLOWS.md, active plans, current source code
**Verdict**: 🟡 CONDITIONAL

## Summary

The Crown Plan and its six child plans represent a well-structured, thorough execution blueprint with strong architectural defensibility. The singleton ops ownership model for SQLite writes, the BullMQ-based durable internal write transport, the credential-stripping sandbox for linters, and the dedicated admin auth surface are all genuinely good engineering decisions. However, the plans contain several risks around stale scoring references, an unspecified ops service entrypoint and process lifecycle, a potential GitLab API rate-limit amplification in feedback polling, and a `prom-client` Bun compatibility gap that needs validation before relying on default collectors. No blockers were found — the plans can proceed with the risks addressed or explicitly accepted.

**Findings**: 0 BLOCKER · 7 RISK · 6 OPTIMIZATION

---

## RISKs

### R1: Crown Plan references stale evaluation scores throughout
- **Dimension**: Structure
- **Finding**: The Crown Plan's Strategic Vision section states "Git Gandalf's current evaluation score is **7.1/10** — tied with GitLab Duo and slightly above CodeRabbit (6.9)." The Scoring Gap Analysis table uses `Current` scores that match the pre-correction evaluation document. The actual corrected scores are GitLab Duo **7.4**, Git Gandalf **7.3**, CodeRabbit **6.9**. Additionally, the Crown Plan states "Data privacy & sovereignty" is **10/10** — but the evaluation document was corrected to acknowledge that code diffs transit to external LLM providers, making a perfect 10 questionable. The completion gate item `CV2 — Update AI-Code-Review-Tool-Evaluation.md with new scores` exists but cannot succeed if the baseline scores in the Crown Plan itself are wrong.
- **Impact**: Implementers will work against wrong baselines. The 9.15 target score calculation is also wrong because it assumes a current 10/10 in privacy that was softened. The Crown Plan's strategic narrative of "closing every competitive gap" is undermined when the starting position is less favorable than stated.
- **Alternative**: Update the Crown Plan's Strategic Vision and Scoring Gap Analysis to reference the corrected evaluation scores (7.4 / 6.9 / 7.3) and recalculate the target weighted score accordingly. Additionally, reconsider whether "Data privacy & sovereignty" should remain 10/10 in the target given the LLM-provider transit reality — a score of 9/10 with an honest footnote is more defensible.

### R2: Ops service entrypoint, lifecycle, and deployment identity are undefined
- **Dimension**: Architecture
- **Finding**: CP3 (OL0.2), CP5, and CP6 (PH0.2, PH1.4) all reference a "singleton ops service" that owns SQLite writes, runs feedback polling, hosts admin APIs, and processes BullMQ write-intent jobs. But no child plan specifies: (a) which source file serves as the ops entrypoint (like `src/worker.ts` for the worker), (b) how the process distinguishes itself from webhook and worker roles at startup, (c) which Hono routes it mounts versus which it skips, (d) how it initializes the BullMQ consumer for learning/analytics job types, or (e) how its config differs from the webhook/worker config. CP6 PH0.2 says "define a singleton internal ops deployment" but the task is descriptive ("define") rather than implementable ("create `src/ops.ts` that does X"). CP3 OL0.2 says the same thing. Neither specifies file names, config discriminators, or startup behavior.
- **Impact**: Without an explicit ops entrypoint and role-detection mechanism, each child plan's implementer will independently invent how the ops role works, leading to inconsistency or circular dependencies. The Helm chart (PH1.4) templates an ops deployment, health probes (PH2.1) define ops-specific readiness checks, and CP3 relies on it for BullMQ job consumption — all referencing something that no plan concretely creates.
- **Alternative**: Add a concrete task to CP6 Phase PH0 that specifies: (a) create `src/ops.ts` as the ops process entrypoint, (b) add a `DEPLOYMENT_ROLE` env var or similar discriminator (`webhook | worker | ops`) to `src/config.ts` that controls which subsystems initialize, (c) define which BullMQ queues the ops process consumes, (d) define which Hono routes it mounts (admin only), and (e) define its graceful shutdown behavior (drain BullMQ consumers, close SQLite, cancel polling timers). This should be the first task in the entire Crown Plan execution sequence since CP3 and CP5 both depend on it.

### R3: Feedback polling may amplify GitLab API load dangerously
- **Dimension**: Resilience
- **Finding**: CP3 OL2.4 defines a periodic polling scheduler with a default interval of 5 minutes. The poll iterates over every MR that has had a Git Gandalf review and fetches discussions plus award_emoji for each Git Gandalf note. For a busy organization (50 developers, 200 MRs/month, ~20 active MRs at any time, ~3 Git Gandalf notes per MR), each poll cycle could produce 60+ GitLab API calls. At 5-minute intervals, that's 720+ API calls/hour just for feedback polling — plus baseline review API calls. The plan mentions "bounded batch sizes, backoff on GitLab 429s" but does not specify: (a) how many MRs are polled per cycle, (b) what the per-cycle API call cap is, (c) how poll scope narrows over time (e.g., stop polling closed MRs), or (d) how the polling window shrinks as signal density drops.
- **Impact**: At scale, feedback polling could consume meaningful GitLab API rate-limit budget, competing with core review operations (fetching diffs, posting comments). If the org scales to 500+ MRs/month, this becomes a production-impacting rate-limit concern.
- **Alternative**: Make the polling design explicit about bounds: (a) poll only MRs that were reviewed in the last N days (default: 14), with a hard cap of M MRs per cycle (default: 50), (b) define a per-cycle API call budget (e.g., 100 calls) with early termination if the budget exhausts, (c) after an MR is merged/closed or has had no new Git Gandalf notes for 7 days, remove it from the active polling set, (d) document that the 5-minute interval is conservative for < 50 active MRs and should be lengthened for larger deployments.

### R4: `prom-client` default metrics rely on Node.js-native APIs that may not exist in Bun
- **Dimension**: Library
- **Finding**: CP5 A1.1 says "Gate `collectDefaultMetrics()` behind a Bun compatibility check and tests before enabling it by default" — this is good awareness. However, the plan uses `prom-client` (v15.1.3, last published 2 years ago) which internally uses `perf_hooks`, `process.cpuUsage()`, `fs.readFileSync('/proc/self/fd')`, and other Node.js-specific APIs for default metrics. Several of these may not be available or may behave differently in Bun. The plan does not include a validation task to confirm which `prom-client` features work under Bun before building the metrics foundation on top of it.
- **Impact**: If `prom-client` is partially incompatible with Bun at runtime, the metrics subsystem could silently fail, emit garbage, or crash on startup. Since CP5 and CP6 both depend on this foundation, a compatibility failure propagates across two child plans.
- **Alternative**: Add an explicit spike task at the start of CP5 Phase A1: (a) install `prom-client`, (b) create a minimal test that registers a Counter, Histogram, and Gauge, calls `registry.metrics()`, and verifies the output format, (c) test `collectDefaultMetrics()` under Bun and document which default metrics work and which don't, (d) document the decision to disable incompatible default metrics or replace `prom-client` with a simpler hand-rolled metrics registry if the library has major compatibility gaps. `prom-client` has 2 dependencies and 126 kB unpacked size — the weight is reasonable, but the Bun compat risk must be validated first, not discovered during implementation.

### R5: PH0 and OL0 duplicate the same admin surface and ops ownership design
- **Dimension**: Structure
- **Finding**: CP6 Phase PH0 (tasks PH0.1, PH0.2, PH0.2a) and CP3 Phase OL0 (tasks OL0.1, OL0.2, OL0.2a, OL0.3) both specify creating the dedicated admin route group, the singleton ops service, and the durable BullMQ write transport. The task descriptions are nearly identical. Since CP3 depends on CP6, this means CP6 PH0 should create the surface and CP3 OL0 should consume it — but both plans describe creating it from scratch.
- **Impact**: If CP6 and CP3 are implemented by different agents or at different times, the same surface may be built twice with incompatible implementations, or an implementer may skip CP3 OL0 thinking PH0 covers it (or vice versa), leaving gaps in the learning-specific wiring.
- **Alternative**: Clarify ownership: CP6 PH0 creates the admin surface, ops service entrypoint, and BullMQ internal write transport. CP3 OL0 should be rewritten as "verify PH0 outputs exist, then wire learning-specific job types and read-path APIs on top of the PH0 foundation." Include an explicit dependency check at the start of OL0: "PH0 must be complete before OL0 begins."

### R6: SQLite on RWO PVC — single-writer is correct but recovery and backup are unspecified
- **Dimension**: Resilience
- **Finding**: The plans correctly prescribe singleton write ownership for SQLite via an ops deployment with an RWO (ReadWriteOnce) PVC. However, no plan addresses: (a) what happens to the learning database if the ops pod crashes during a write and the WAL is corrupted, (b) how the SQLite database is backed up (periodic dump? PVC snapshot? rsync to object storage?), (c) what the recovery procedure is if the PVC is lost, (d) whether there is a mechanism to export the learning database for disaster recovery or migration.
- **Impact**: The learning database and analytics data are the most stateful components introduced by the Crown Plan. Losing this data means losing all organizational learning — the single most impactful competitive feature. Since SQLite with WAL mode is crash-safe in normal circumstances, actual data loss risk is low, but the absence of any backup or recovery plan means an infrastructure failure (node loss, PVC corruption) destroys accumulated institutional knowledge.
- **Alternative**: Add a task to CP6 (in PH6 or as a new task in PH1.4) that specifies: (a) a periodic SQLite `.backup()` command triggered by the ops service (e.g., daily), written to a configurable object storage path or a second PVC, (b) a recovery procedure documented in the operational runbook, (c) a maximum acceptable data loss window (e.g., "last 24 hours of feedback data is tolerable to lose; learned patterns are reconstructible from feedback events").

### R7: Worker HPA based on CPU is a poor proxy for review throughput
- **Dimension**: Architecture
- **Finding**: CP6 PH1.7 defines the worker HPA scaling on CPU utilization (target: 70%). Workers spend most of their time waiting on LLM API responses (network I/O), not burning CPU. A worker at 10% CPU may be fully saturated with 2 concurrent reviews waiting on Bedrock. CPU-based HPA will under-scale because the bottleneck is LLM concurrency, not compute. The plan notes "queue-depth-based scaling is added only after a metrics-adapter path is implemented and validated" — which is reasonable — but the interim CPU HPA offers a false sense of autoscaling coverage.
- **Impact**: Workers may appear idle to KPA while the review queue grows. Users will see increasing review latency without HPA triggering scale-out. Manual scaling will be required in practice.
- **Alternative**: (a) Document in PH1.7 that CPU-based worker HPA is known to be a poor proxy and is included only as a starting point, not a production-grade scaling strategy, (b) add an explicit follow-up task in CP5 (after Prometheus metrics exist) to implement queue-depth-based KEDA ScaledObject or Prometheus-adapter-based HPA for worker pods, (c) until custom metrics HPA is ready, recommend operators set a fixed `replicaCount` based on expected MR throughput rather than relying on CPU HPA.

---

## OPTIMIZATIONs

### O1: CP4 walkthrough generator should share the existing LLM pipeline rather than making a separate call
- **Dimension**: Architecture
- **Finding**: CP4 RO2.1 creates a walkthrough generator that makes a "separate, focused LLM call" to produce per-file descriptions. The context agent already receives all diff files and produces `changeCategories` and `riskAreas`. Extending the context agent's output to include per-file summaries would save a separate LLM call entirely and keep the walkthrough data consistent with the intent analysis.
- **Impact**: An extra LLM call adds $0.02 per review (as the plan correctly estimates) and ~2-5 seconds of latency. Marginal for one review, but at 200 MRs/month this is 200 extra LLM calls.
- **Alternative**: Consider extending the context agent prompt to optionally produce per-file change descriptions when the MR exceeds the file-count threshold. This reuses the existing LLM call and keeps all change understanding in one pass. The token budget constraint from RO2.4 should apply to the context agent's extended output section.

### O2: Linter execution could run in parallel with repo clone verification
- **Dimension**: Architecture
- **Finding**: CP2 L2.1 specifies running linters "after repo clone and config loading, before `executeReview()`." Since the repo is already cloned/updated by this point, linter execution and the pipeline's MR-details fetch / checkpoint loading could run concurrently. The current pipeline fetches MR state (discussions, notes, diff versions) after the clone — linters and MR state loading are independent.
- **Impact**: Running linters sequentially adds their execution time (bounded at 30 seconds per CP2 L1.2) to the critical path. Running them in parallel with MR state loading saves wall-clock time.
- **Alternative**: Document linter execution as a parallelizable step. After repo clone and config loading, kick off `runLinters()` concurrently with the remaining MR data fetches. Merge results before agent execution begins.

### O3: CP1 glob matching fallback from `Bun.Glob` to `picomatch` needs an explicit test matrix
- **Dimension**: Library
- **Finding**: CP1 specifies "Glob matching defaults to `Bun.Glob`; an external matcher is added only if Bun-native behavior proves insufficient." The plan includes glob validation in tests (C1.5) but does not define a specific pattern test matrix that covers: negation (`!`), brace expansion (`{a,b}`), double-star (`**`), dot-file matching, and platform-specific edge cases. Without this matrix, the "proves insufficient" trigger is undefined.
- **Alternative**: Add an explicit glob compatibility test fixture in C1.5 covering at least: `**/*.ts`, `!**/*.test.ts`, `src/{api,agents}/**`, `.hidden/**`, `**/file.{js,ts}`, and `dir/` (trailing slash). If any pattern fails under `Bun.Glob`, document the gap and add `picomatch` at that point.

### O4: Migration runner should use transactions
- **Dimension**: Resilience
- **Finding**: CP3 OL1.3 specifies a forward-only migration runner reading SQL files in order. The plan does not mention wrapping each migration in a transaction. If a migration partially completes and crashes, the schema is left in an undefined state.
- **Alternative**: Wrap each migration file execution in `BEGIN/COMMIT` with a `ROLLBACK` on failure. Record the migration as applied only after the transaction commits. This is standard practice for SQL migration runners and costs zero additional complexity.

### O5: `bun audit` is not currently functional
- **Dimension**: Security
- **Finding**: The Crown Plan's locked design decision says "dependency-introducing phases must include a `bun audit` remediation or explicit risk-acceptance step before merge." Testing confirmed that `bun audit` is not a built-in command and the `audit` npm package does not resolve as a Bun executable. CP6 PH0.3 formalizes this gate but does not specify which audit tool to use.
- **Alternative**: Specify the concrete audit tool: either `npx audit-ci` (works with Bun's npm-compatible lockfile), or `bunx better-npm-audit`, or a direct call to `npm audit --omit=dev` using the system npm. Add the chosen tool to the project's dev dependencies or document it as a CI step. Include the audit tool decision in PH0.3 so implementers know exactly what to run.

### O6: Crown Plan should include the Gandalf Awakening plan in its coordination map
- **Dimension**: Structure
- **Finding**: The active `Gandalf-awakening-personality-plan.md` modifies `src/api/router.ts`, `src/publisher/gitlab-publisher.ts`, and `src/api/pipeline.ts` — all files that CP1, CP4, and CP6 also modify. The Crown Plan does not reference the Awakening plan in its dependency graph or coordination notes.
- **Alternative**: Add a note in the Crown Plan that identifies the Gandalf Awakening plan as a parallel active plan touching overlapping files. Specify coordination: either (a) complete the Awakening plan before Crown Plan implementation begins on CP4 (publisher changes), or (b) implement Crown Plan changes in a way that preserves Awakening's trigger-context and tone-split hooks.

---

## Confirmed Strengths

1. **Singleton ops ownership model**: The decision to route all SQLite writes through a singleton ops service via durable BullMQ jobs is architecturally sound. It avoids multi-writer contention, preserves Bun-native SQLite performance, and reuses the existing queue infrastructure. This is a better design than most first attempts at this problem.

2. **Security-first linter sandbox**: CP2's sandbox contract (stripped credentials, bounded output, bounded time, isolated temp, instance-owned profiles only, no repo-defined commands) is thorough. The explicit deferral of ESLint to a future dependency-hydration plan shows disciplined scoping.

3. **Phased feature flags**: Each new capability (linters, learning, walkthroughs, analytics) is gated behind both instance-level env vars (`LEARNING_ENABLED`, etc.) and repo-level `.gitgandalf.yaml` feature flags. This means every feature can be rolled out incrementally and rolled back without code changes.

4. **Honest limitations in the evaluation document**: The evaluation admits every Git Gandalf weakness candidly (bus factor, no SAST, pre-production, hidden maintenance cost). The Crown Plan maps directly to those weaknesses with quantified target scores. This is credible engineering, not wishful marketing.

5. **Dependency discipline**: The locked design decision requiring `bun audit` remediation per dependency-introducing phase, the preference for `Bun.Glob` over `picomatch`, and the explicit ESLint deferral all show strong supply-chain discipline. The current dependency tree is remarkably lean (13 direct deps for a multi-provider, multi-integration service).

6. **Well-specified database schema**: CP3's SQLite schema includes unique dedup indexes, cursor-based sync state, and a clean separation between raw feedback events and derived learned patterns. The schema is ready for implementation without ambiguity.

7. **Role-specific readiness probes**: PH2.1's design of role-specific readiness (webhook checks queue, worker checks Valkey, ops checks SQLite) with external dependency reachability as diagnostics-only is operationally correct. Most plans make readiness depend on everything, causing cascading failures.

8. **Token budget awareness in CP4**: The walkthrough generator's bounded token budget (4K input, 2K output, conditional trigger at 5+ files) shows cost awareness. The token cost analysis table at the bottom of CP4 is exactly the kind of data a VP would want to see.

---

## Verdict Details

The Crown Plan is **CONDITIONAL** — it can proceed with the following risks addressed before implementation begins:

**Must resolve before starting CP3 or CP5:**
- **R2** (ops service entrypoint): Define the concrete ops process entrypoint, role-detection mechanism, and BullMQ consumer wiring. Without this, CP3 and CP5 implementers have no foundation to build on.
- **R5** (PH0/OL0 duplication): Clarify that PH0 creates the admin/ops foundation and OL0 consumes it.

**Must resolve before starting CP5:**
- **R4** (`prom-client` Bun compat): Add a spike task to validate `prom-client` under Bun before building the metrics layer.

**Should resolve before starting CP3 at scale:**
- **R3** (feedback polling bounds): Specify concrete polling boundaries and API call budgets.

**Should resolve before Crown Plan is considered complete:**
- **R1** (stale scores): Update the Crown Plan's baseline scores and target calculation.
- **R6** (SQLite backup): Add backup/recovery procedure.
- **R7** (worker HPA): Document CPU HPA limitations and plan for queue-depth scaling.

No blockers were found. The architectural foundations are solid and the plans can proceed in the prescribed dependency order once the conditional risks are addressed.

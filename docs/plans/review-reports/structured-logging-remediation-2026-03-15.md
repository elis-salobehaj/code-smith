# Structured Logging Remediation Plan

## 1. Holistic Overview (Executive Summary)

The structured logging implementation is functionally sound: LogTape is wired correctly, request correlation is present in the runtime path, production `console.*` usage has been removed from `src/`, and validation gates currently pass. The primary gap is completion hygiene rather than logging architecture.

Four issues prevent the plan from being considered fully complete. First, local debug workflows still lack a dedicated file log target, which makes following a noisy review pipeline harder than necessary. Second, several agent-facing and human-facing docs still describe a pre-Phase-4 system and therefore contradict the implemented pipeline, publisher, and deployment surface. Third, the plan file is internally inconsistent: the frontmatter completion block says the work is complete, while the body checklist remains unchecked. Fourth, test-time logging is only configured locally inside `tests/logger.test.ts`, so the broader suite still initializes production-style logging and emits JSON logs during normal test runs.

The remediation should therefore start by adding a debug-mode file sink at `logs/codesmith-dev.log`, then repair documentation correctness, then fix plan bookkeeping, then normalize suite-wide test logging behavior. This ordering closes the completion gap with the least risk and improves day-to-day debugging immediately.

## 2. Remediation Objective

Bring the structured logging plan to actual completion by adding a root-level debug log file, aligning the affected docs with the real implementation, correcting plan-tracking inconsistencies, and tightening the test harness so logging behavior is deliberate across the full suite rather than only in logger-specific tests.

## 3. Ordered Remediation Steps

- [x] **[agent] Add debug-mode file logging**: Update `src/logger.ts` so debug-mode runs also write JSON Lines logs to `logs/codesmith-dev.log` under the project root, creating `logs/` automatically if it does not exist. Preserve the existing stdout sink, keep the implementation Bun-native, and ensure test runs do not write production-style logs to that file. Objective: give local development a stable, predictable place to inspect detailed logs.

- [x] **[agent] Repair agent architecture docs**: Update `docs/context/ARCHITECTURE.md` so it reflects the implemented runtime surface. Remove stale claims that `src/api/pipeline.ts` is a Phase 1 stub, that the agent subsystem is not wired into the API pipeline, and that the publisher/full pipeline wiring are still pending. Objective: make agent-facing architecture docs trustworthy again for future implementation agents.

- [x] **[agent] Repair human architecture docs**: Update `docs/context/ARCHITECTURE.md` to reflect the actual Phase 4-complete state. Fix the opening summary, directory descriptions, phase-ownership table, publisher/test status, and any remaining wording that says pipeline wiring, publishing, Docker, or README work are still pending. Objective: align human-facing architecture docs with the implemented system.

- [x] **[agent] Repair onboarding and development guides**: Update `docs/guides/GETTING_STARTED.md` and `docs/guides/DEVELOPMENT.md` so they no longer describe the pipeline as log-only or list implemented features as not implemented. Also update the stale test-count statement to reflect the current suite size. Objective: ensure contributor-facing guidance matches the repository state.

- [x] **[agent] Re-run stale-reference audit after doc fixes**: Search the affected docs for stale wording tied to the audit findings, including references to the pipeline being a stub, publishing being unimplemented, Docker packaging being open, and outdated test counts. Objective: confirm the docs overhaul is actually complete rather than partially repaired.

- [x] **[agent] Normalize structured-logging plan bookkeeping**: Update `docs/plans/implemented/structured-logging-plan.md` so the body checklist matches the implemented status already claimed in frontmatter. Either mark the detailed tasks complete or otherwise make the plan internally consistent without duplicating contradictory completion mechanisms. Objective: satisfy AGENTS.md plan-tracking requirements and eliminate the current mixed status signal.

- [x] **[agent] Add suite-wide test logging control**: Introduce a shared test-time logging strategy so non-logger tests do not rely on production `initLogging()` behavior. Likely targets include a shared test setup path or a test-aware initialization guard that routes normal suite logging to a no-op or controlled sink while preserving explicit capture behavior in `tests/logger.test.ts`. Objective: make L5.1 true at suite scope, not only inside one test file.

- [x] **[agent] Strengthen test validation for logging harness behavior**: Add or update tests so the chosen suite-wide logging strategy is exercised intentionally and does not break existing imports of `src/index.ts` or logger-specific capture tests. Objective: prove the remediation closes the harness gap without regressing the passing suite.

- [x] **[agent] Run final closure validation**: Run `bun run check`, `bun run typecheck`, and `bun test` after the remediation changes. Objective: confirm code, docs, and test harness updates still satisfy repo validation gates.

## 4. Required Validations

- [x] `bun run check`
- [x] `bun run typecheck`
- [x] `bun test`
- [x] Manual verification that `LOG_LEVEL=debug` writes JSON Lines logs to `logs/codesmith-dev.log`
- [x] Grep/search verification that stale architecture and onboarding statements identified in the audit are removed from the affected docs
- [x] Manual review of `docs/plans/implemented/structured-logging-plan.md` to confirm its body status and frontmatter status no longer contradict each other
- [x] Manual review of test output to confirm suite-wide logging behavior is intentional and not leaking production-style JSON noise unexpectedly

## 5. Documentation and Plan Updates

- [x] Update `src/logger.ts`
- [x] Update `docs/context/ARCHITECTURE.md`
- [x] Update `docs/context/ARCHITECTURE.md`
- [x] Update `docs/guides/GETTING_STARTED.md`
- [x] Update `docs/guides/DEVELOPMENT.md`
- [x] Update `docs/plans/implemented/structured-logging-plan.md`
- [x] Reconfirm `docs/README.md` still accurately summarizes the implemented logging status after the remediation
- [x] Ensure no new documentation contradictions remain between agent docs, human docs, guides, and the implemented plan file

## 6. Human Decisions Needed

- [x] None currently identified. The audit findings are documentation, bookkeeping, and test-harness consistency issues, and they can be remediated without changing the approved logging architecture or plan scope.

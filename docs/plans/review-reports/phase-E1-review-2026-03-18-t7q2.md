## Plan Review: Review Edge Cases Hardening — Phase E1

**Plan file**: `docs/plans/implemented/review-edge-cases-hardening.md`
**Reviewed against**: AGENTS.md, docs/context/*, active plans
**Verdict**: 🟡 CONDITIONAL

### Summary

Phase E1 delivers the trigger-context plumbing correctly: new type file, router builds the context, pipeline accepts and threads it into `ReviewState`, tests verify both trigger modes, and WORKFLOWS.md is updated. However, two frontmatter checklist items (E1.2, E1.3) claim behavioral enforcement that doesn't exist yet and won't until E2+. Additionally, ARCHITECTURE.md was not updated to reflect the new file and changed call signature.

**Findings**: 0 BLOCKER · 3 RISK · 1 OPTIMIZATION

---

### RISKs

#### R1: E1.2 and E1.3 checked off without behavioral enforcement
- **Dimension**: Structure
- **Finding**: E1.2 ("Make `/ai-review` always execute a review run even when the current head was reviewed already") is only accidentally true — no checkpoint exists to block it, so there is nothing to bypass. E1.3 ("Keep automatic MR events idempotent for already-reviewed heads") is not true — automatic events still re-run reviews on already-reviewed heads. The E0 guard only suppresses duplicate summary *notes*, not review execution itself. The E1 deliverables section describes only plumbing (type definition, router/pipeline/state threading), not behavioral enforcement. Marking these complete conflates "infrastructure exists" with "behavior is enforced."
- **Impact**: Future phases (E2–E4) may assume the skip/run branching already works and skip implementing it, or audits may incorrectly judge E1 as fully shipped.
- **Alternative**: Uncheck E1.2 and E1.3 in the plan frontmatter. These items are E2+ deliverables that depend on the checkpoint system. E1's contribution is establishing the typed `triggerContext` that E2+ will branch on.

#### R2: ARCHITECTURE.md runtime surface is stale
- **Dimension**: Docs
- **Finding**: `docs/context/ARCHITECTURE.md` line 30 still says `runPipeline(event)` (single-arg). The Runtime Surface section does not list `src/api/trigger.ts`. The plan's E1 deliverables section specified "Docs to update: `docs/context/WORKFLOWS.md`" but ARCHITECTURE.md documents the same webhook flow and is now inconsistent with the actual code signature `runPipeline(event, trigger)`.
- **Impact**: Agents reading ARCHITECTURE.md will have a stale mental model of the router→pipeline interface. This will cause confusion when implementing E2+ which threads trigger context further.
- **Alternative**: Update ARCHITECTURE.md: (1) add `src/api/trigger.ts` to Runtime Surface, (2) update webhook flow step 6 to `runPipeline(event, trigger)`.

#### R3: Human ARCHITECTURE.md contains stale `runPipeline(event)` reference
- **Dimension**: Docs
- **Finding**: `docs/context/ARCHITECTURE.md` line 120 references `runPipeline(event)` without the trigger parameter.
- **Impact**: Human documentation is inconsistent with actual code.
- **Alternative**: Update `docs/context/ARCHITECTURE.md` line 120 to reference `runPipeline(event, trigger)`.

---

### OPTIMIZATIONs

#### O1: Mock type signature in webhook tests does not match `runPipeline` signature
- **Dimension**: Tests
- **Finding**: `mockRunPipeline` was typed as `async () => undefined` (zero-arg), but `runPipeline` now takes two arguments. TypeScript correctly flagged `mock.calls[0]` destructuring as invalid on a zero-length tuple. Tests passed at runtime (Bun mocks don't enforce arity) but `tsc --noEmit` failed with 6 errors.
- **Impact**: `bun run typecheck` gate fails, blocking CI if type checking is enforced.
- **Alternative**: Type the mock as `async (_event: unknown, _trigger: ReviewTriggerContext) => undefined` to match the real signature.

---

### Confirmed Strengths

- `src/api/trigger.ts` is clean and minimal — type-only file with no runtime dependencies, exactly matching the plan's shape.
- Router correctly builds trigger context *after* filtering and *before* dispatch, with note event context including `noteId` and `rawCommand` as specified.
- Pipeline logs `triggerMode` and `triggerSource` at the entry point — good observability from day one.
- `ReviewState.triggerContext` is threaded correctly and all test `makeBaseState()` helpers were updated.
- Test coverage is meaningful: verifies both MR and note event trigger construction, plus the update action variant. The mock capture pattern (`mock.calls[0]`) is clean.
- WORKFLOWS.md update is thorough — both the request-handling steps and the pipeline section were updated.

### Verdict & Remediation Details

🟡 CONDITIONAL — all `[agent]` items, no human decisions needed. R1 (premature checkboxes) and R2/R3 (stale docs) should be remediated before marking E1 complete.

### Ordered Remediation Steps

- [ ] **[agent] R1: Uncheck E1.2 and E1.3 in plan frontmatter**: Revert E1.2 and E1.3 checkboxes to unchecked in `docs/plans/implemented/review-edge-cases-hardening.md`. These are not E1 deliverables — they describe behavioral enforcement that arrives in E2+.
- [ ] **[agent] R2: Update ARCHITECTURE.md runtime surface and webhook flow**: In `docs/context/ARCHITECTURE.md`: (1) add `src/api/trigger.ts: typed review trigger context (automatic vs manual, source event, optional note id)` to the Runtime Surface list after the `schemas.ts` entry, (2) update webhook flow step 6 from `runPipeline(event)` to `runPipeline(event, trigger)` and add a step between 4 and 5 noting trigger context construction.
- [ ] **[agent] R3: Fix stale human docs reference**: In `docs/context/ARCHITECTURE.md` line 120, update `runPipeline(event)` to `runPipeline(event, trigger)`.
- [ ] **[agent] Add E1 remediation line to plan**: Add `- [x] Remediation complete — see docs/plans/review-reports/phase-E1-review-2026-03-18-t7q2.md` after E1.4 in the plan frontmatter.

### Required Validations

- [ ] `bun run check`
- [ ] `bun run typecheck`
- [ ] `bun test`
- [ ] Documentation references verified (no stale behavior, removed files, or outdated config)

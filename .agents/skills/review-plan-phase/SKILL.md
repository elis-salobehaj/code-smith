---
name: review-plan-phase
description: >
  Principal-engineer review and remediation workflow for GitGandalf implementation
  phases driven by markdown plan files. Audits whether an implementation fully followed
  a plan, checks code and architecture against AGENTS.md conventions, categorizes
  findings as BLOCKER / RISK / OPTIMIZATION with mandatory actionable alternatives,
  saves a report to docs/plans/review-reports/, and automatically executes remediation
  when no human decisions are required. Waits for human input only when findings
  require architectural decisions, scope changes, or explicit approval.
argument-hint: 'Describe the plan file, phase, and implementation scope to review.'
license: Apache-2.0
---

# Review Plan Phase

> **Pipeline position**: `implement` → **`review-plan-phase`** → (auto-remediate or wait for human)

Use this skill to perform a thorough principal-engineer review of an implementation
phase, save a structured report, and execute remediation — all in a single pass.

The agent reviews, reports, and remediates in one invocation, stopping only
when human decisions are required.

## Outcome

Produce a review report saved to `docs/plans/review-reports/` that:
- compares the implementation against the plan item by item
- classifies every finding as `BLOCKER`, `RISK`, or `OPTIMIZATION` with a mandatory actionable alternative
- identifies human decisions needed (if any) and surfaces them prominently
- delivers a verdict: `🔴 NOT READY`, `🟡 CONDITIONAL`, or `🟢 READY`
- includes ordered remediation steps with autonomy tags (`[agent]` or `[human]`)

Then:
- If **no human decisions** are needed: immediately execute all remediation steps, then
  update the active plan with a one-line entry noting remediation was completed and
  pointing to the report file.
- If **human decisions** are needed: stop after saving the report. Present the human
  decisions clearly. Resume remediation only after the human responds.

## When To Use

Use this skill for:
- reviewing work completed against a plan in `docs/plans/active/` or `docs/plans/backlog/`
- auditing whether an agent or engineer followed the plan thoroughly or cut corners
- checking whether plan completion was reflected in docs, indexes, and status trackers
- executing fixes for gaps found during review — without a separate remediation pass

Do not use this skill for:
- reviewing a plan before implementation — use `review-plan-implementation` instead
- writing the implementation from scratch
- making opportunistic cleanups unrelated to the plan

## Required Inputs

Before starting, identify:
- The plan file being reviewed (if ambiguous, ask before proceeding)
- The phase or scope within that plan to audit
- Any explicit repo rules from [AGENTS.md](../../../AGENTS.md)

## Review Standard

Review as a principal engineer, not as a formatter or style checker.

- Audit as if reviewing another engineer's work — assume nothing was done correctly
  until you have read the evidence
- Favor behavioral correctness, architecture fit, and plan fidelity over cosmetic observations
- Require evidence for every conclusion
- Treat unimplemented plan details as misses even if the code looks reasonable
- Treat undocumented architectural deviations as findings
- Treat incomplete plan bookkeeping and stale docs as real completion failures
- A task is not done until code, tests, plans, and docs all align

## Procedure

### Step 0 — Establish the Changed Surface

Before reading plan items, determine what was implemented:
- Check for recent git changes or explicit completion claims in the plan file (checked
  boxes, phase-complete notes)
- List the directories and files most likely touched, using the plan's file inventory
  as the starting point
- Scope the review to what changed — do not audit code that predates this phase
- Identify all explicit completion claims so you know exactly what is being validated

### Step 1 — Load Governing Materials

Read these before judging any implementation:
1. The target plan file in full
2. [AGENTS.md](../../../AGENTS.md)
3. [docs/agents/context/ARCHITECTURE.md](../../../docs/agents/context/ARCHITECTURE.md)
4. [docs/agents/context/WORKFLOWS.md](../../../docs/agents/context/WORKFLOWS.md)
5. Active plans under `docs/plans/active/` to check for coordination conflicts

### Step 2 — Extract Concrete Obligations

Convert the plan phase into reviewable obligations:
- Files that should exist or be modified
- APIs or behaviors that should be implemented
- Validation, testing, and error-handling expectations
- Architecture decisions committed in writing
- Documentation and plan-status updates required for completion

### Step 3 — Inspect the Implementation

Use codebase tools (file reads, directory listings, grep) to review changed code,
config, tests, prompts, scripts, and documentation. Look for:
- Missing files or stubbed sections
- TODO-driven gaps disguised as completion
- Hard-coded shortcuts that avoid the plan's intended design
- Shallow implementations that satisfy only the happy path
- Mismatches between claimed architecture and actual code structure

### Step 4 — Check AGENTS.md Compliance

Verify at minimum:
- Bun-only workflows and commands
- Zod at external boundaries instead of unchecked casts
- Biome-centric lint and format conventions
- Plan checkboxes and phase status updated where applicable
- `docs/README.md` updated when plan status changed
- Security constraints preserved when file or search access is involved

### Step 5 — Verify Implementation Depth

For each major plan item, ask:
- Is the real implementation present, or only scaffolding?
- Are edge cases, validation, and failure modes handled?
- Does the code match the stated architecture, or only approximate it?
- Do tests meaningfully prove the intended behavior?
- Are docs aligned with the final implementation, not the original intent?

### Step 6 — Audit Completion Bookkeeping

Review all plan and documentation touchpoints:
- The source plan file (checkboxes, status)
- `docs/plans/active/`, `docs/plans/implemented/`, backlog moves
- `docs/README.md`
- Related READMEs in `docs/agents/`, `docs/humans/`, or top-level docs

If a phase is claimed complete but these updates are missing or stale, report
incomplete completion hygiene.

### Step 7 — Classify Findings

Categorize every finding using **exactly** these severity levels:

| Severity | Definition | Gate |
|---|---|---|
| `BLOCKER` | Implementation materially fails the plan or introduces architectural/security risk. | Phase **cannot** be considered complete until resolved. |
| `RISK` | Important plan details, conventions, tests, or docs are missing or weak. Likely to cause problems. | Should be resolved before completion. May proceed with documented acceptance. |
| `OPTIMIZATION` | Implementation works but can be improved. Cleaner approach, tighter scope, better pattern. | Address during remediation or defer with justification. |

**Every finding must include:**
1. **Severity**: `BLOCKER` | `RISK` | `OPTIMIZATION`
2. **Dimension**: Which area it falls under (Architecture, Library, Security, Resilience, Structure, Docs, Tests)
3. **Finding**: What is wrong — specific, evidence-based
4. **Impact**: What happens if not addressed
5. **Alternative**: A concrete actionable fix — not "consider improving" but "do X in file Y"

### Step 8 — Build Remediation Plan

Convert findings into ordered remediation steps:

1. **Tag each step** with autonomy classification:
   - `[agent]` — can be executed without human judgment
   - `[human]` — requires architectural decision, scope confirmation, or explicit approval

2. **Order by dependency and risk**: blockers first, then risks, then optimizations.
   Schema changes before handlers. Architecture fixes before tests. Implementation
   before documentation.

3. **Group related fixes**: If multiple findings stem from one root cause, group them
   under one remediation workstream.

4. **Define completion criteria**: For each step, specify what evidence shows the gap
   is closed.

### Step 9 — Save Report and Act

1. **Save the report** to `docs/plans/review-reports/<phase>-review-<YYYY-MM-DD>-<hash>.md`
   (e.g., `phase-3-review-2026-03-18-k4h7.md`) using the format specified below.
   Generate a random 4-character alphanumeric hash to ensure uniqueness when the same
   phase is reviewed multiple times on the same day.
   The file **must** exist on disk before any remediation begins. Do not deliver the
   report only as chat output.

2. **Evaluate the remediation path:**

   - **No `[human]` items exist**: Immediately execute all remediation steps. After
     completion, add a one-line entry to the active plan's current phase:
     ```
     - [x] Remediation complete — see `docs/plans/review-reports/<filename>.md`
     ```
     Then run `bun run check && bun run typecheck && bun test` to validate.

   - After remediation execution, perform a **lightweight re-verification** of the
     original findings: re-read the affected files and confirm each remediated finding
     is actually closed. If any finding remains open after remediation, report it as
     a residual gap in the chat output.

   - **`[human]` items exist**: Stop after saving the report. Present the human
     decisions clearly in chat. Do not begin any remediation until the human responds.
     Once the human provides decisions, execute all `[agent]` items and any `[human]`
     items that were approved.

## Report Format

The saved report file must follow this structure exactly:

```markdown
## Plan Review: [Plan Title — Phase N]

**Plan file**: `docs/plans/.../plan-file.md`
**Reviewed against**: AGENTS.md, docs/agents/context/*, active plans
**Verdict**: 🔴 NOT READY / 🟡 CONDITIONAL / 🟢 READY

### Human Decisions

> Omit this section entirely if no human decisions are needed.

1. **[Decision title]**: [1-2 sentence summary of what the human needs to decide and why]

### Summary

[2-3 sentence executive summary of the phase's readiness]

**Findings**: X BLOCKER · Y RISK · Z OPTIMIZATION

---

### BLOCKERs

#### B1: [Short title]
- **Dimension**: [Architecture | Library | Security | Resilience | Structure | Docs | Tests]
- **Finding**: [What is wrong]
- **Impact**: [What happens if not addressed]
- **Alternative**: [Concrete fix]

---

### RISKs

#### R1: [Short title]
- **Dimension**: [Architecture | Library | Security | Resilience | Structure | Docs | Tests]
- **Finding**: [What is wrong]
- **Impact**: [What happens if not addressed]
- **Alternative**: [Concrete fix]

---

### OPTIMIZATIONs

#### O1: [Short title]
- **Dimension**: [Architecture | Library | Security | Resilience | Structure | Docs | Tests]
- **Finding**: [What is wrong]
- **Impact**: [What happens if not addressed]
- **Alternative**: [Concrete fix]

---

### Confirmed Strengths

[Call out aspects of the phase that are well-implemented, well-tested, or particularly thorough]

### Verdict & Remediation Details

[Explain the verdict. If CONDITIONAL, state exactly which findings must be resolved.
If NOT READY, state the minimum changes required.]

### Ordered Remediation Steps

- [ ] **[agent/human] Step title**: Description of what to fix, which files, and completion criteria.
- [ ] **[agent/human] Step title**: ...

### Required Validations

- [ ] `bun run check`
- [ ] `bun run typecheck`
- [ ] `bun test`
- [ ] Documentation references verified (no stale behavior, removed files, or outdated config)
```

## Evidence Rules

- Cite the exact plan item or requirement behind each finding.
- Cite the exact file or code area that supports the conclusion.
- Do not claim a gap without pointing to what is missing.
- Do not mark an item complete just because a similarly named file exists.
- If evidence is mixed, say it is partial and explain why.

## Decision Rules

- If the plan says a file, behavior, or workflow should exist and it does not, mark it missing.
- If the implementation substitutes a simpler approach without documenting the deviation,
  mark it as a gap.
- If AGENTS.md requires a convention and the code violates it, report it even if the code works.
- If tests are absent for meaningful new behavior, treat as incomplete unless the plan
  explicitly excluded tests.
- If docs or plan indexes were supposed to change and did not, the phase is not fully complete.
- Fix blockers before polish. Prefer root-cause fixes over symptom patches.
- If multiple findings stem from one architectural issue, group them.
- If a finding reflects plan ambiguity rather than implementation failure, flag it as a
  clarification item.
- Every critique must have an actionable alternative.

## Verdict Rules

- Zero BLOCKERs and zero RISKs → `🟢 READY`
- RISKs but no BLOCKERs → `🟡 CONDITIONAL`
- Any BLOCKERs → `🔴 NOT READY`

## Completion Checks

Before finishing, verify:
- Every plan obligation was evaluated — none skipped
- Every finding has severity, dimension, finding, impact, and alternative
- Finding counts in the summary match actual findings listed
- Verdict matches severity distribution
- Confirmed strengths are called out
- Report file is saved to `docs/plans/review-reports/`
- Remediation steps are ordered with autonomy tags
- If no human decisions: remediation was executed and plan updated
- If human decisions: report was presented and agent is waiting for response
- Post-remediation validation gates passed (`bun run check`, `bun run typecheck`, `bun test`)

## Preferred Prompts

- Review this phase implementation against the plan and fix what's broken.
- Audit whether this agent followed the plan thoroughly or cut corners, then remediate.
- Review and remediate Phase 3 of the master plan.
- Check if this phase is actually done — code, tests, docs, plan tracking — and fix gaps.
- Perform a principal-engineer review of this plan phase and execute the remediation.
---
name: plan-phase-remediation
description: >
  Post-review remediation planning workflow for GitGandalf plan-driven work.
  Use after a human has reviewed an audit from review-plan-phase and wants an
  ordered fix plan that closes implementation, architecture, testing,
  documentation, and plan-tracking gaps without starting code changes yet.
argument-hint: 'Describe the review report, target plan phase, and remediation constraints.'
license: Apache-2.0
---

# Plan Phase Remediation

> **Pipeline position**: `implement` → `review-plan-phase` → **`plan-phase-remediation`**

> **Constraint**: This skill produces a detailed remediation plan saved as a Markdown file under `docs/plans/review-reports`, starting with a holistic executive summary. Once the plan is saved, you **must automatically continue with executing the remediation steps** without waiting for human approval, except for tasks marked as `[human]`.

Use this skill after a review report has already identified what is missing or weak
in a plan-driven implementation. The purpose is to turn findings into an ordered,
practical remediation plan, save it as a digestible report, and automatically execute the fixes.

## Outcome

Produce and execute a remediation plan that:
- begins with a high-level holistic overview of the findings and recommendations so a human can quickly digest the current state
- groups findings into coherent workstreams and orders fixes by dependency and risk
- includes code, tests, docs, and plan-tracking updates required for closure
- is saved as a Markdown file under `docs/plans/review-reports`
- is then automatically executed by the agent without waiting for explicit human approval

## When To Use

Use this skill for:
- turning a `review-plan-phase` audit report into an execution plan, document it, and execute it
- sequencing fixes across code, tests, docs, and plan bookkeeping
- reducing a large audit report into a focused remediation backlog

Do not use this skill for:
- re-running the original architecture review
- hand-waving fixes without tying them back to review findings

## Required Inputs

Before planning remediation, gather:
- the review report or findings list
- the original plan file
- the current implementation surface
- any human constraints on scope, timeline, or acceptable tradeoffs



## Procedure

1. Re-anchor on the governing plan and audit.
   Read the plan and the completed review output together so remediation stays tied to the original commitments.

2. Normalize the findings.
   Convert the audit into concrete fix items with:
   - affected files or systems
   - missing behavior or quality gap
   - required tests
   - required documentation or plan-status updates
   - autonomy classification: mark each fix as `[agent]` if an agent can execute it without human judgment, or `[human]` if it requires architectural decision, scope confirmation, or explicit approval

3. Identify dependencies.
   Determine what must happen first, such as schema changes before handlers, architecture fixes before tests, or documentation updates after implementation.

4. Build an ordered fix plan.
   Sequence remediation from highest leverage and highest risk to lowest, while keeping related changes together.
   Note which groups of fixes can be safely parallelized versus which are strictly sequential due to shared state, ordering constraints, or architectural dependencies.

5. Define completion criteria.
   For each remediation step, specify what evidence will show that the gap is closed.

6. Call out approval points.
   If any finding implies a design change, scope reduction, or plan deviation, mark it for human confirmation before implementation.

7. Save the plan and execute.
   Deliver the ordered remediation plan by writing it to a file under `docs/plans/review-reports/<report-name>.md`. Once saved, immediately continue with implementing the `[agent]` remediation steps without waiting for human approval.

## Decision Rules

- Fix blockers before polish.
- Prefer root-cause fixes over symptom patches.
- Include tests and docs in the same remediation step when they are part of done criteria.
- If multiple findings stem from one architectural issue, group them under one remediation workstream.
- If a finding reflects plan ambiguity rather than implementation failure, flag it as a clarification item instead of pretending it is resolved.

## Completion Checks

Before finishing, verify that the remediation plan answers:
- What should be fixed first?
- Which fixes are prerequisites for others?
- Which files or systems are likely affected?
- Which tests need to be added or strengthened?
- Which docs, plans, or indexes must be updated as part of closure?
- Which items need human approval before coding begins?

## Output Format

Generate a Markdown-formatted remediation plan and save it to `docs/plans/review-reports/`. The file must be structurally identical to this:

### 1. Holistic Overview (Executive Summary)
A concise, high-level summary of the findings and recommendations. This serves as an entry point for a human to quickly digest the current state of the plan phase.

### 2. Remediation Objective
Summarize what the detailed plan needs to correct.

### 3. Ordered Remediation Steps
Provide a sequentially ordered task list using Markdown checkboxes (`- [ ]`). Each item must include the autonomy tag, context, target file(s), and objective.
Example:
- [ ] **[agent] Fix Zod schema**: Add `.strict()` to `webhookPayloadSchema` in `src/api/schemas.ts` to reject unexpected webhook fields.
- [ ] **[human] Confirm task-queue scope**: The plan specifies Phase 5 BullMQ work; confirm whether to include it in this remediation pass or defer to a future phase.

### 4. Required Validations
State which tests, checks, and reviews should confirm completion.

### 5. Documentation and Plan Updates
List the non-code updates (also using `- [ ]` checkboxes) needed before the phase can be considered done.

### 6. Human Decisions Needed
Call out anything that should be approved or answered by the human.

## Preferred Prompts

- Turn this review-plan-phase audit into an ordered remediation plan.
- Based on this implementation review report, tell me what to fix first and what can wait.
- Prepare a remediation plan for this plan phase without making any code changes yet.
- Convert these audit findings into a concrete follow-up implementation plan with docs and plan updates included.
---
name: plan-implementation
description: >
  Produces thorough, repo-aware implementation plans for GitGandalf. Gathers deep
  context from AGENTS.md, docs/, and source code before proposing architecture,
  tech stack decisions, tradeoffs, and phased implementation steps. Produces a
  markdown plan file consistent with existing plan conventions. Asks the user
  clarifying questions when decisions impact architecture, structure, or tech stack
  before finalizing.
argument-hint: 'Describe the feature, change, or capability to plan. Include any constraints or preferences.'
license: Apache-2.0
---

# Plan Implementation

Use this skill to produce a detailed, actionable implementation plan for a new
feature, capability, or architectural change in GitGandalf. The plan must be
grounded in the actual codebase — not generic advice — and must follow the
conventions established by existing plans in this repository.

## Outcome

Produce a markdown plan file saved to `docs/plans/backlog/` (default) or `docs/plans/active/`
(when the user explicitly requests active, or when no active plans exist) that:
- is grounded in the current architecture, tech stack, and conventions of GitGandalf
- evaluates technology choices and tradeoffs when the feature introduces new tools, libraries, or patterns
- proactively suggests superior alternatives when a clearly better option exists (more performant,
  more secure, open-source, actively maintained, community-loved, near drop-in replacement) —
  even when not strictly required by the feature
- proposes a phased implementation with concrete, checkable tasks per phase
- identifies affected files and systems
- includes a YAML frontmatter block consistent with existing plans
- includes a completion checklist with unchecked task IDs that match the phase structure
- places architectural diagrams and plan overview at the top of the document for fast human consumption
- follows the structure, depth, and conventions of existing plans in `docs/plans/`

The plan must not be finalized without first presenting key decisions and tradeoffs
to the user for feedback, when those decisions impact the architecture or structure
of the repository or when the agent has a recommended alternative worth discussing.

## When To Use

Use this skill for:
- planning a new feature or capability before implementation begins
- planning an architectural change, refactor, or migration
- evaluating and deciding on new libraries, tools, or runtime changes
- breaking down a large initiative into phased, reviewable implementation steps
- producing a plan that other agents (or humans) will implement and audit

Do not use this skill for:
- implementing code directly — this skill produces a plan, not code
- reviewing an existing implementation against a plan — use `review-plan-phase` instead
- minor bug fixes or one-line changes that do not warrant a plan

## Procedure

### Phase 1 — Deep Context Gathering

Before any analysis or proposal work, build a thorough understanding of the
repository by reading primary sources in this order:

1. Read [AGENTS.md](../../../AGENTS.md) in full.
   This is the entrypoint. It contains the mission, stack essentials, critical rules,
   documentation structure, skill inventory, plan completion gates, and pointers to
   all further documentation.

2. Read [docs/README.md](../../../docs/README.md) to understand the documentation index.
   This file maps every documentation area and lists the current implementation status
   of all plan phases. Use it as a navigation guide for what to read next.

3. Read the unified context documentation under `docs/context/`:
   - [ARCHITECTURE.md](../../../docs/context/ARCHITECTURE.md) — current runtime surface,
     webhook flow, repo manager, tool system, internal protocol boundary, publisher behavior
   - [CONFIGURATION.md](../../../docs/context/CONFIGURATION.md) — environment variables,
     defaults, required fields
   - [WORKFLOWS.md](../../../docs/context/WORKFLOWS.md) — implemented webhook flow,
     repo cache workflow, tool execution, full review workflow, logging/observability

4. Read relevant design documents if the feature touches areas with existing design decisions:
   - `docs/designs/` for design rationale and diagrams

5. Read active plans under `docs/plans/active/` to understand in-flight work and avoid conflicts.

6. If the feature touches existing source code, read the relevant source files to understand
   the current implementation. Do not assume — verify. Use directory listings, file reads,
   and grep searches as needed to build confidence in your understanding.

7. If the feature introduces dependencies on external systems, APIs, or libraries, research
   their compatibility with the GitGandalf stack (Bun runtime, TypeScript strict mode,
   Hono framework, Zod validation patterns).

> **Documentation rule**: The repo now uses unified docs under `docs/context/*` and `docs/designs/*`.
> Start with `docs/context/*` and read deeper design docs only when the task needs that extra rationale.

### Phase 2 — Feature Analysis and Scoping

With full context gathered:

1. Restate the feature or change in your own words to confirm understanding.
   Identify the core problem being solved and the expected user-visible or system-visible outcome.

2. Identify the blast radius:
   - Which existing modules, files, or systems are affected?
   - Which existing behaviors change?
   - Which new modules or files need to be created?
   - Are there any conflicts with active plans?

3. Identify constraints from AGENTS.md and existing conventions:
   - Bun-only tooling (no npm/yarn/npx)
   - Zod validation at all external data boundaries
   - Biome for linting/formatting
   - Internal protocol boundary for LLM interactions
   - Security sandboxing for file/search tools
   - Plan and docs update requirements

### Phase 3 — Technology Evaluation and Tradeoffs

When the feature introduces new dependencies, tools, patterns, or architectural choices:

1. Identify the decision points. For each:
   - List candidate approaches or libraries
   - Evaluate each against GitGandalf's stack constraints (Bun compatibility, TypeScript
     strict mode, bundle size, maintenance health, license)
   - State the tradeoffs clearly: what you gain, what you give up, what risks exist
   - Make a recommendation with rationale

2. Produce a technology decision table when multiple choices exist:

   | Concern | Option A | Option B | Recommendation | Rationale |
   |---|---|---|---|---|
   | ... | ... | ... | ... | ... |

3. For architecture-level decisions (new module boundaries, new data flows, new external
   integrations), sketch the proposed design with enough detail to evaluate feasibility.
   Use Mermaid diagrams when the change involves new data flows, multi-component
   interactions, or pipeline changes. Strongly encourage diagrams — they make plans
   significantly easier for humans to review.

> **Skip this phase** when the feature is purely behavioral and introduces no new
> dependencies or architectural patterns. Not every plan needs a tech evaluation.
>
> **Proactive alternative suggestions**: Even when the feature does not require a new
> dependency, if you identify an existing dependency or pattern in the codebase that has
> a clearly superior alternative — more performant, more secure, open-source, actively
> maintained, community-loved, and close to a drop-in replacement — take the opportunity
> to suggest it. Frame it as a recommendation, not a blocker.

### Phase 4 — User Feedback Loop

Before writing the final plan, present decisions and tradeoffs to the user when:

- A decision impacts the repository's architecture or module structure
- A decision introduces a new dependency or removes an existing one
- Multiple viable approaches exist with meaningfully different tradeoffs
- You have a recommended alternative that differs from what the user might expect
- The feature scope is ambiguous and could be interpreted in multiple valid ways

For each question:
- Explain **what** the decision is
- Explain **why** it matters
- Present the options with tradeoffs
- State your recommendation and reasoning

Format questions clearly so the user can respond with minimal effort:
```
**Decision: [short title]**
[Context and why this matters]

- **Option A**: [description] — [tradeoff summary]
- **Option B**: [description] — [tradeoff summary]

**Recommendation**: Option A because [reason].
```

> **This phase is not obligatory for every decision.** Use judgment. If a decision has
> one clearly correct answer given the existing conventions, make it and move on.
> Reserve user questions for genuine decision points where the answer shapes the plan.

If no decisions require user input, state that explicitly and proceed to plan drafting.

### Phase 5 — Plan Drafting

Produce the plan file following these structural conventions:

#### YAML Frontmatter

Every plan must begin with a YAML frontmatter block:

```yaml
---
title: "<Descriptive Plan Title>"
status: backlog
priority: <high | medium | low>
estimated_hours: <range, e.g. 10-16>
dependencies:
  - <path to prerequisite plan, if any>
created: <YYYY-MM-DD>
date_updated: <YYYY-MM-DD>

related_files:
  - <list of files this plan will create or modify>

tags:
  - <relevant tags>

completion:
  - "# Phase X1 — Phase Title"
  - [ ] X1.1 Task description
  - [ ] X1.2 Task description
  - "# Phase X2 — Phase Title"
  - [ ] X2.1 Task description
---
```

#### Plan Body Structure

After frontmatter, the plan body should include these sections as appropriate.

> **Architecture-first layout**: When the plan involves architectural changes, the
> Mermaid diagram and high-level overview must appear at the very top of the body
> (immediately after the title), before the executive summary or any prose. This
> lets a human reader see the shape of the change before reading the details.

1. **Title** (H1) — matches the frontmatter title
2. **High-Level Architecture** (when architecture changes) — Mermaid diagram showing the
   proposed design and how it fits into the existing system. **Must be first after the title**
   when present, so the reader immediately sees the structural change.
3. **Executive Summary** — 3-5 sentences explaining the problem, approach, and expected outcome
4. **Resolved Decisions** or **Technology Stack** (when Phase 3 produced decisions) —
   a table summarizing decisions made and rationale
5. **Problem Statement** or **Product Goal** — detailed description of what this plan achieves
6. **Current Behavior / Gaps** (when modifying existing functionality) — what exists today and what is missing
7. **Directory Structure** (when new files/modules are introduced) — tree showing where
   new code lives relative to the existing structure
8. **Phased Implementation** — the core of the plan, with:
   - One H2 section per phase
   - A clear goal statement for each phase
   - Concrete subtasks with unique IDs matching the frontmatter completion checklist
   - Each subtask should specify the file to create/modify and the behavior to implement
   - Every phase **must** end with a documentation overhaul step and a test coverage step
     (see Phase Design Conventions below for details and allowed exceptions)
9. **Open Questions** (if any remain after user feedback) — tracked for resolution during implementation

#### Phase Design Conventions

- Use a consistent task ID scheme: `<PhasePrefix><PhaseNumber>.<TaskNumber>`
  (e.g., `P1.1`, `E2.3`, `L4.1`). Pick a prefix letter that relates to the plan topic.
- Order phases by dependency: foundational work first, integration last
- Keep phases small enough to be independently reviewable and testable
- The final phase should always include a plan-completion audit step using the
  `review-plan-phase` skill

##### Mandatory Documentation Overhaul Per Phase

Every phase **must** include a documentation overhaul step as one of its final tasks.
Documentation must never fall out of date — keeping it current requires surgical precision.

The documentation step must:
- Update all affected docs under `docs/context/` (ARCHITECTURE.md, CONFIGURATION.md,
  WORKFLOWS.md) to reflect the changes introduced in the phase
- Update `docs/README.md` when implementation status, plan status, or current state changes
- Update `docs/guides/` when the phase introduces user-visible
  changes, new configuration, or new operational behavior
- Update `docs/designs/` when architecture or tech stack decisions are modified
- Verify that no documentation references stale behavior, removed files, or outdated
  configuration after the phase is applied

There are no exceptions to this rule. Every phase that changes behavior, configuration,
architecture, or public-facing surface must update the corresponding documentation in
the same phase.

##### Mandatory Test Coverage Per Phase

Every phase **must** include a test coverage step. Tests keep the repo stable over time
and must be thorough, meaningful, and useful — not token gestures.

The test step must:
- Add or update tests that cover the new behavior introduced in the phase
- Verify that existing tests still pass and are not broken by the changes
- Ensure tests are meaningful: they should test actual behavior, edge cases, and
  failure modes — not just assert that code exists
- Run `bun test` to confirm the full suite passes after the phase

**Allowed exceptions for test deferral**:
- When the plan is intricate and a phase produces intermediate scaffolding that cannot
  be meaningfully tested in isolation, tests may be deferred to the next phase that
  completes the testable surface. The deferral must be explicit in the plan with a
  note explaining why and which future phase will cover the tests.
- When a big-bang approach makes sense (e.g., a migration where intermediate states are
  not stable), tests may be consolidated in a final testing phase. This must be a
  deliberate plan design choice, not a shortcut. The final test phase must be
  comprehensive and cover all deferred testing obligations.

The default expectation is: tests are updated per phase. Deferral is the exception
and must be justified in the plan text.

### Phase 6 — Save and Update Docs Index

1. Determine the save location:
   - **Default**: `docs/plans/backlog/<kebab-case-plan-name>.md`
   - **Active**: Only use `docs/plans/active/` when the user explicitly requests it,
     or when `docs/plans/active/` is currently empty
   Use a descriptive filename that matches the plan title.

2. Update [docs/README.md](../../../docs/README.md):
   - Add the new plan to the **Implementation Plans** section under the matching
     category (**Backlog** or **Active**) based on where the file was saved
   - Add a row to the **Implementation Status** table with status ⬜ Planned and a brief summary
   - Keep the existing format and ordering conventions

3. Present the saved plan to the user for final review.

## Decision Rules

- Ground every proposal in the actual codebase, not in generic best practices.
- Prefer approaches consistent with existing patterns in the repo unless there is a
  strong reason to introduce a new pattern.
- When in doubt about scope, prefer smaller plans that can be extended over ambitious
  plans that may stall.
- If a feature overlaps with an active plan, note the overlap and propose how to
  coordinate rather than duplicating work.
- Obey all critical rules from AGENTS.md — Bun-only, Zod validation, Biome formatting,
  internal protocol boundary, security sandboxing.
- Do not recommend tools, libraries, or patterns without verifying Bun runtime compatibility.
- When an existing dependency has a clearly superior open-source alternative that is more
  performant, more secure, actively maintained, community-loved, and close to a drop-in
  replacement, suggest it — even if the current feature request does not require it.

## Completion Checks

Before presenting the plan as ready:
- The plan file exists on disk at `docs/plans/backlog/<name>.md` (or `active/` if explicitly requested)
- YAML frontmatter is complete with all required fields
- The completion checklist in frontmatter matches the phase structure in the body
- Every phase has concrete, actionable tasks with unique IDs
- Every phase includes a documentation overhaul step — no phase may omit this
- Every phase includes a test coverage step, or explicitly justifies deferral with a named target phase
- Technology decisions are justified with tradeoffs, not just stated
- Affected files are listed in `related_files`
- `docs/README.md` is updated with the new plan entry
- The plan does not conflict with or duplicate active plans
- All critical rules from AGENTS.md are respected in the plan's design
- The final phase includes a review/audit step
- When architectural changes are involved, the Mermaid diagram appears at the top of the body

## Preferred Prompts

- Plan the implementation of [feature] for GitGandalf.
- Create an implementation plan for adding [capability] to the review pipeline.
- I want to add [library/tool] to GitGandalf — plan the integration.
- Plan a migration from [current approach] to [new approach].
- Break down [large initiative] into a phased implementation plan.

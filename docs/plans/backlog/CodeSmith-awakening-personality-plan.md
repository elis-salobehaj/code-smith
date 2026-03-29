---
title: "CodeSmith Awakening Personality Plan"
status: backlog
priority: high
estimated_hours: 10-16
dependencies:
  - docs/plans/backlog/code-smith-master-plan.md
created: 2026-03-15
date_updated: 2026-03-29

related_files:
  - .env.example
  - src/config.ts
  - src/api/router.ts
  - src/api/pipeline.ts
  - src/api/schemas.ts
  - src/gitlab-client/client.ts
  - src/publisher/gitlab-publisher.ts
  - tests/webhook.test.ts
  - tests/publisher.test.ts
  - README.md
  - docs/README.md
  - docs/guides/GETTING_STARTED.md
  - docs/context/CONFIGURATION.md
  - docs/context/WORKFLOWS.md
  - docs/context/ARCHITECTURE.md
tags:
  - personality
  - product
  - trigger-design
  - gitlab
  - review-ux
completion:
  - "# Phase P1 — Trigger Alias Expansion"
  - [ ] P1.1 Add configurable trigger aliases in env/config
  - [ ] P1.2 Accept `/ai-review`, `/code-smith`, and `/codesmith` for MR note triggers
  - [ ] P1.3 Parse and preserve trigger suffix text after the alias
  - [ ] P1.4 Add router and parsing tests for the new aliases
  - "# Phase P2 — CodeSmith Trigger Context"
  - [ ] P2.1 Introduce a typed trigger context model (`alias`, `mode`, `suffix`, `rawNote`)
  - [ ] P2.2 Pass trigger context from webhook entry to pipeline/publisher boundaries
  - [ ] P2.3 Keep `/ai-review` in professional mode and `/code-smith` or `/codesmith` in CodeSmith mode
  - "# Phase P3 — Immediate Acknowledgement Note"
  - [ ] P3.1 Post an immediate top-level MR note for CodeSmith-mode note triggers
  - [ ] P3.2 Generate acknowledgements from original CodeSmith response templates
  - [ ] P3.3 Let suffix text lightly influence the acknowledgement when present
  - [ ] P3.4 Make acknowledgement failure non-blocking for the review pipeline
  - "# Phase P4 — Final Summary Tone Split"
  - [ ] P4.1 Keep inline finding comments fully professional for all trigger modes
  - [ ] P4.2 Make `/ai-review` final summary fully professional
  - [ ] P4.3 Make CodeSmith-mode final summary concise, calm, and craft-focused
  - [ ] P4.4 Use `CODE SMITH: REVIEW BLOCKED` only in CodeSmith-mode failure summaries with high or critical findings
  - "# Phase P5 — Voice Guide, Docs, and Validation"
  - [ ] P5.1 Add a documented CodeSmith voice guide with approved tone boundaries
  - [ ] P5.2 Update setup and workflow docs for trigger aliases and behavior split
  - [ ] P5.3 Add tests for acknowledgement and summary tone behavior
  - [ ] P5.4 Run review-quality validation and plan-completion audit
---

# CodeSmith Awakening Personality Plan

## Executive Summary

CodeSmith's current manual note trigger, `/ai-review`, is functional but generic.
This plan introduces a stronger product identity without complicating the first
implementation pass.

The initial implementation should accept three note-trigger aliases:

- `/ai-review`
- `/code-smith`
- `/codesmith`

These aliases will not all behave the same way.

- `/ai-review` remains professional and plain.
- `/code-smith` and `/codesmith` activate a CodeSmith-flavored interaction mode.
- When CodeSmith mode is triggered from an MR note, CodeSmith should reply
  immediately with a concise, craft-focused acknowledgement note before the
  review completes.
- The full review then proceeds as usual.
- Inline finding comments remain professional and direct for all modes.
- The final summary note may become CodeSmith-flavored only when the trigger
  mode is CodeSmith mode.

This is deliberately not a roleplay system. The goal is a distinct product
identity with a low-risk implementation surface.

## Locked Product Decisions

The following decisions are treated as approved for this plan.

### Trigger aliases

CodeSmith should accept any note beginning with:

- `/ai-review`
- `/code-smith`
- `/codesmith`

### Tone behavior

- `/ai-review` means professional mode.
- `/code-smith` or `/codesmith` mean CodeSmith mode.
- A CodeSmith-mode note should produce an immediate acknowledgement note in a
  concise, composed, and craft-focused voice.
- A professional-mode note should not produce playful acknowledgement copy.

### Review output boundaries

- Inline review findings stay professional in all modes.
- Only the top-level note experience changes tone.
- The final CodeSmith-mode summary may use `CODE SMITH: REVIEW BLOCKED` when the
  review fails with one or more high or critical findings.
- That phrase should not be used for professional-mode runs.

### Suffix handling

If the user writes extra text after the trigger alias, CodeSmith should preserve
that text and use it as light input to the immediate acknowledgement.

Example:

- `/code-smith check the auth flow`

In that case, CodeSmith should recognize:

- the review trigger alias
- CodeSmith mode
- the suffix `check the auth flow`

The suffix should influence the acknowledgement tone, but the review mechanics
should remain unchanged.

## Research Foundations For CodeSmith's Personality

This plan should not reduce CodeSmith to generic corporate boilerplate. The target
personality should feel like a precise, reliable craftsperson: clear, steady,
and serious about quality without being stiff.

### Research synthesis

The most important CodeSmith traits are:

- **Guide first, posture never**: CodeSmith should direct the user calmly and
  clearly instead of sounding authoritarian.
- **Warmth with discipline**: supportive when things are going well, firm when
  the code needs correction.
- **Humility over grandstanding**: authority comes from evidence and precision,
  not from hype.
- **Dry wit rather than clowning**: any humor should be brief, observant, and
  lightly technical, not meme-driven.
- **Measured cadence**: phrasing should read well in a GitLab note and stay easy
  to scan.
- **Craft imagery**: forge, steel, polish, edge, and finish fit the product
  identity better than fantasy references.
- **Protective severity at critical moments**: the strongest lines should be
  reserved for real thresholds, warnings, and refusals.

### Product translation of that research

CodeSmith should sound like:

- composed
- technically grounded
- watchful
- concise
- craft-oriented

CodeSmith should not sound like:

- a parody brand voice
- a quote machine
- an internet meme bot
- a smug snarker
- an overcaffeinated sales pitch

## Tone Guardrails

Treat the following as implementation constraints for the first pass.

- CodeSmith mode should feel composed, exact, and slightly elevated.
- It should not sound like cosplay or marketing fluff.
- Immediate acknowledgements should stay short enough to feel immediate.
- Final summaries should remain readable by engineers first.
- Inline findings remain professional and unchanged.
- `/ai-review` stays plain and professional end to end.

## Voice Principles

### Principle 1: Original first, references second

The best experience is not to lean on overused slogans.
Instead, the app should produce original CodeSmith-inspired prose with a small,
intentional allowance for a few short phrases in pivotal moments.

### Principle 2: Reserve the strongest lines for the strongest moments

If every acknowledgement is dramatic, the app becomes tiring.
The most forceful language should be held back for:

- strong rejection summaries
- major warnings
- rare delight moments when the user clearly invites playfulness

### Principle 3: Keep GitLab ergonomics intact

The voice layer must not make the tool harder to use.

- trigger aliases should be simple and memorable
- acknowledgement notes should be short
- inline findings should remain professional and actionable
- the summary note should still be scannable by engineers

### Principle 4: Do not let personality degrade review clarity

The identity layer is a product differentiator, not the product itself.
Severity, evidence, reproducibility, and merge safety remain primary.

## Implementation Phases

### Phase P1 — Trigger Alias Expansion

Add configurable aliases in the trigger parser and webhook router.
The routing rules should distinguish professional mode from CodeSmith mode and
preserve any trailing suffix text.

### Phase P2 — CodeSmith Trigger Context

Introduce a typed trigger context and pass it through the webhook, pipeline,
and publisher boundaries so the system can make mode-aware decisions without
loosening the core review contract.

### Phase P3 — Immediate Acknowledgement Note

When CodeSmith mode is triggered from a note, post a brief acknowledgement note
immediately, then continue the review pipeline asynchronously.
Failures in the acknowledgement path must not block review execution.

### Phase P4 — Final Summary Tone Split

Keep inline findings professional for all modes. Only the final summary note
changes tone, and only in CodeSmith mode.

### Phase P5 — Voice Guide, Docs, and Validation

Document the approved voice boundaries, update setup/workflow docs, and add
validation tests so the mode split stays stable over time.

## Success Criteria

The plan is complete when:

1. `/ai-review`, `/code-smith`, and `/codesmith` all route correctly.
2. CodeSmith mode posts a fast acknowledgement note without blocking the review.
3. Inline comments remain professional and useful.
4. Final summaries reflect the selected mode without leaking it into the review
   findings themselves.
5. The docs and tests describe the behavior clearly enough that future changes
   do not reintroduce brand drift.

---
title: "Gandalf Awakening Personality Plan"
status: active
priority: high
estimated_hours: 10-16
dependencies:
  - docs/plans/active/git-gandalf-master-plan.md
created: 2026-03-15
date_updated: 2026-03-15

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
  - [ ] P1.2 Accept `/ai-review`, `/gandalf`, and `/git-gandalf` for MR note triggers
  - [ ] P1.3 Parse and preserve trigger suffix text after the alias
  - [ ] P1.4 Add router and parsing tests for the new aliases
  - "# Phase P2 — Gandalf Trigger Context"
  - [ ] P2.1 Introduce a typed trigger context model (`alias`, `mode`, `suffix`, `rawNote`)
  - [ ] P2.2 Pass trigger context from webhook entry to pipeline/publisher boundaries
  - [ ] P2.3 Keep `/ai-review` in professional mode and `/gandalf` or `/git-gandalf` in Gandalf mode
  - "# Phase P3 — Immediate Acknowledgement Note"
  - [ ] P3.1 Post an immediate top-level MR note for Gandalf-mode note triggers
  - [ ] P3.2 Generate acknowledgements from original Gandalf-inspired response templates
  - [ ] P3.3 Let suffix text lightly influence the acknowledgement when present
  - [ ] P3.4 Make acknowledgement failure non-blocking for the review pipeline
  - "# Phase P4 — Final Summary Tone Split"
  - [ ] P4.1 Keep inline finding comments fully professional for all trigger modes
  - [ ] P4.2 Make `/ai-review` final summary fully professional
  - [ ] P4.3 Make Gandalf-mode final summary wise and Middle-earth-flavored
  - [ ] P4.4 Use `🧙 YOU SHALL NOT PASS!` only in Gandalf-mode failure summaries with high or critical findings
  - "# Phase P5 — Voice Guide, Docs, and Validation"
  - [ ] P5.1 Add a documented Gandalf voice guide with approved tone boundaries
  - [ ] P5.2 Update setup and workflow docs for trigger aliases and behavior split
  - [ ] P5.3 Add tests for acknowledgement and summary tone behavior
  - [ ] P5.4 Run review-quality validation and plan-completion audit
---

# Gandalf Awakening Personality Plan

## Executive Summary

GitGandalf's current manual note trigger, `/ai-review`, is functional but generic.
This plan introduces a stronger product identity without complicating the first
implementation pass.

The initial implementation should accept three note-trigger aliases:

- `/ai-review`
- `/gandalf`
- `/git-gandalf`

These aliases will not all behave the same way.

- `/ai-review` remains professional and plain.
- `/gandalf` and `/git-gandalf` activate a Gandalf-flavored interaction mode.
- When Gandalf mode is triggered from an MR note, GitGandalf should reply
  immediately with a wise, Middle-earth-flavored acknowledgement note before the
  review completes.
- The full review then proceeds as usual.
- Inline finding comments remain professional and corporate in tone for all modes.
- The final summary note may become Gandalf-flavored only when the trigger mode
  is Gandalf mode.

This is deliberately not a full roleplay system. The goal is a strong and unique
product identity with a low-risk implementation surface.

## Locked Product Decisions

The following decisions are treated as approved for this plan.

### Trigger aliases

GitGandalf should accept any note beginning with:

- `/ai-review`
- `/gandalf`
- `/git-gandalf`

### Tone behavior

- `/ai-review` means professional mode.
- `/gandalf` or `/git-gandalf` mean Gandalf mode.
- A Gandalf-mode note should produce an immediate acknowledgement note in a wise,
  Middle-earth-flavored voice.
- A professional-mode note should not produce playful acknowledgement copy.

### Review output boundaries

- Inline review findings stay professional in all modes.
- Only the top-level note experience changes tone.
- The final Gandalf-mode summary may use `🧙 YOU SHALL NOT PASS!` when the review
  fails with one or more high or critical findings.
- That phrase should not be used for professional-mode runs.

### Suffix handling

If the user writes extra text after the trigger alias, GitGandalf should preserve
that text and use it as light input to the immediate acknowledgement.

Example:

- `/gandalf face the balrog`

In that case, GitGandalf should recognize:

- the review trigger alias
- Gandalf mode
- the suffix `face the balrog`

The suffix should influence the acknowledgement tone, but the review mechanics
should remain unchanged.

## Research Foundations For Gandalf's Personality

This plan should not reduce Gandalf to random fantasy slang or meme quotes.
The target personality comes from repeated, research-backed traits associated
with Tolkien's character and how readers recognize him.

### Research synthesis

Based on character summaries and scholarly descriptions referenced through
Wikipedia, Britannica, and commentary on Tolkien/Ian McKellen's interpretation,
the most important Gandalf traits are:

- **Guide first, ruler never**: Gandalf persuades, advises, warns, and steadies.
  He does not posture like a tyrant.
- **Warmth with underlying fire**: he is often kind, merry, and encouraging, but
  can become sharply severe when confronting folly, danger, or corruption.
- **Humility over grandeur**: he does not brag about power; authority emerges
  from certainty, duty, and moral weight.
- **Dry wit rather than clowning**: humor is best when sly, observant, and brief,
  not chaotic or internet-meme driven.
- **Old-world cadence**: phrasing should feel deliberate, spoken aloud, and a bit
  elevated, but still clear and readable in a GitLab note.
- **Light-versus-shadow imagery**: fire, flame, shadow, road, counsel, watch,
  burden, and courage are thematically fitting.
- **Protective severity at critical moments**: the iconic force of Gandalf is
  best saved for real thresholds, warnings, and refusals.

### Product translation of that research

GitGandalf should sound like:

- wise
- grounded
- watchful
- warm but not soft
- theatrical only in measured doses

GitGandalf should not sound like:

- a parody wizard
- a constant quote machine
- a lore spam bot
- a smug fantasy snarker
- an Ian McKellen impersonator

## Tone Guardrails

Treat the following as implementation constraints for the first pass.

- Gandalf mode should feel wise, watchful, slightly theatrical, and brief.
- It should not sound like parody cosplay.
- Immediate acknowledgements should stay short enough to feel immediate.
- Final summaries should remain readable by engineers first.
- Inline findings remain professional and unchanged.
- `/ai-review` stays plain and professional end to end.

## Voice Principles

### Principle 1: Original first, references second

The best experience is not to stitch together famous movie lines.
Instead, the app should produce original Gandalf-inspired prose with a small,
intentional allowance for a few short canonical phrases in pivotal moments.

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

## Proposed Configuration Design

### Initial env surface

For the first implementation pass, the simplest configuration is:

```env
GANDALF_TRIGGER_ALIASES=/ai-review,/gandalf,/git-gandalf
```

This gives operators one obvious place to configure supported note prefixes.

### Behavioral interpretation

The code should derive mode from the matched alias:

- matched `/ai-review` => `professional`
- matched `/gandalf` => `gandalf`
- matched `/git-gandalf` => `gandalf`

This keeps configuration simple while still supporting the required behavior split.

### Parsing rules

- match prefixes after trimming leading and trailing whitespace
- prefer longest-match-first to avoid accidental ambiguity
- preserve remaining suffix text after the alias
- treat empty suffix text as valid
- only note events on merge requests should use this logic

## Proposed Runtime Model

Introduce a small internal trigger-context model near the webhook or pipeline
boundary, for example:

```ts
type ReviewTriggerMode = "professional" | "gandalf";

interface ReviewTriggerContext {
  alias: "/ai-review" | "/gandalf" | "/git-gandalf";
  mode: ReviewTriggerMode;
  rawNote: string;
  suffix: string;
}
```

This model should then flow into the places that need it:

- note-trigger routing
- immediate acknowledgement generation
- final summary-comment formatting

## Immediate Acknowledgement Design

### Desired behavior

When a user writes a Gandalf-mode note trigger, GitGandalf should quickly post a
top-level MR note before the full review completes.

That note should:

- acknowledge the summons
- sound wise and Middle-earth-flavored
- optionally respond to the suffix text
- stay short enough to feel immediate rather than ceremonial

### Example acknowledgment directions

These are tonal examples, not final locked copy:

- generic Gandalf-mode trigger: a brief acknowledgement that the matter will be examined
- `face the balrog`: a line that recognizes the danger and promises a steady look into the shadow
- `read the runes`: a line about examining signs, craft, or hidden faults
- `pass judgment`: a line about counsel, scrutiny, or measured judgment

### Safety and reliability rules

- acknowledgement posting failure must not block the review
- acknowledgement copy should be generated from deterministic templates first,
  not from an LLM call
- acknowledgement content should be based on trigger mode and light suffix parsing,
  not on unbounded freeform roleplay

## Approved Copy Matrix

This section turns the personality system into a deterministic content inventory.
Implementation should treat these as the approved starter templates for the first
awakening pass.

The matrix is keyed by:

- trigger mode
- suffix theme for immediate acknowledgements
- verdict for final summary notes

The matrix applies only to top-level note content.
Inline finding comments remain professional and are intentionally excluded.

### Rendering rules

- Markdown is allowed and encouraged in moderation.
- Small icons are approved.
- Tiny atmospheric sub-lines using blockquote italics are approved in final summaries.
- Horizontal rules, if used at all, belong only in final summaries and not in immediate acknowledgements.
- Large ASCII art blocks are out of scope for the first pass.
- The first pass should use deterministic templates, not freeform generation.

These constraints exist to add character without making MR threads noisy or hard to scan.

### Canonical visual palette

- `🧙` Gandalf identity, authority, summons, refusal
- `🔥` scrutiny, danger, resolve, confrontation
- `🕯️` watchfulness, quiet counsel, close reading
- `⚠️` failing verdicts and caution
- `✅` approval
- `💬` ambiguity, discussion, unsettled path
- `⚖️` judgment, weighing, measured scrutiny

Avoid large decorative flourishes beyond this palette. Tiny one-line accents are preferred over elaborate visual gags.

## Immediate Acknowledgement Copy Matrix

These acknowledgements are used only for Gandalf-mode note triggers.

### Matrix key: `mode = gandalf`, `suffixTheme = generic`

#### Variant A

```md
🧙 **GitGandalf has answered the call.**

I will look into this work with a careful eye. What is hidden will be brought into the light.
```

#### Variant B

```md
🕯️ **Very well. I am upon the trail.**

Give me a little while, and I will return with counsel.
```

#### Variant C

```md
🔥 **The matter is before me now.**

I will examine the craft, the cracks, and the shadow around it before I speak.
```

#### Variant D

```md
🧙 **You have my attention.**

I will read through this change as one reads uncertain runes: slowly, and with purpose.
```

#### Variant E

```md
🕯️ **So be it. The review begins.**

I will weigh what was changed, what was missed, and what may yet trouble the road ahead.
```

### Matrix key: `mode = gandalf`, `suffixTheme = balrog-shadow-darkness`

Match examples:

- `face the balrog`
- `balrog`
- `shadow`
- `darkness`

#### Variant A

```md
🔥 **A bold summons.**

If there is a Balrog in these depths, we shall find where it woke.
```

#### Variant B

```md
🧙 **Then let us look into the fire without flinching.**

I will search for the danger beneath the stone, not merely the smoke above it.
```

#### Variant C

```md
⚠️ **Very well. We go down into the deep places.**

If shadow clings to this change, I will name it plainly.
```

### Matrix key: `mode = gandalf`, `suffixTheme = runes-signs-omens`

Match examples:

- `read the runes`
- `runes`
- `signs`
- `omens`

#### Variant A

```md
🕯️ **The runes are laid before us.**

I will read what they say, and also what they carefully avoid saying.
```

#### Variant B

```md
🧙 **I will study the markings with care.**

Bad craft often leaves signs long before it leaves ruins.
```

### Matrix key: `mode = gandalf`, `suffixTheme = judgment-weighing`

Match examples:

- `pass judgment`
- `judge this`
- `weigh this`

#### Variant A

```md
⚖️ **Judgment should be slow enough to be fair.**

I will weigh the evidence and return with a clear reckoning.
```

#### Variant B

```md
🧙 **Then let it be examined in full.**

Not all faults are equal, and not all silence is safety.
```

### Matrix key: `mode = gandalf`, `suffixTheme = light-reveal-shadow`

Match examples:

- `bring the light`
- `reveal`
- `show the shadow`

#### Variant A

```md
🕯️ **Light is most useful where the path is uncertain.**

I will see what this change reveals, and what it tries to keep in shadow.
```

#### Variant B

```md
🔥 **Then we shall have a little light.**

Enough, I hope, to tell sound stone from hollow.
```

### Matrix key: `mode = gandalf`, `suffixTheme = counsel-guidance`

Match examples:

- `counsel`
- `guide us`
- `help me`

#### Variant A

```md
🧙 **Counsel is best given after a clear look.**

I will review the change and return with guidance worth keeping.
```

#### Variant B

```md
🕯️ **You ask for counsel; you shall have it.**

Let me first see where this road truly leads.
```

### Matrix key: `mode = professional`, `suffixTheme = any`

Professional mode should not use playful acknowledgement copy.
For the first pass, either do not post an acknowledgement at all, or use one of
the following minimal acknowledgements if parity is desired.

#### Variant A

```md
🤖 **Review requested.**

Starting analysis now.
```

#### Variant B

```md
🤖 **Review started.**

I’ll post findings and summary when complete.
```

## Final Summary Tone Strategy

### Professional mode

If the review was triggered by `/ai-review`, the final summary note should remain
fully professional.

### Gandalf mode

If the review was triggered by `/gandalf` or `/git-gandalf`, the final summary
note may adopt a Gandalf-flavored opening and closing while preserving the
existing factual structure.

The existing summary still needs:

- verdict
- severity table
- findings list
- actionable clarity

### Recommended markdown composition

The preferred first-pass structure for top-level final summaries is:

```md
## [mode-specific title]

[2-4 sentence intro]

### Summary

| Severity | Count |
|---|---|
...
```

This keeps Gandalf-mode summaries distinctive while preserving the same scannable engineering shape as professional mode.

### Failure language

Use `🧙 YOU SHALL NOT PASS!` only when both of the following are true:

- trigger mode is Gandalf mode
- the final review contains one or more high or critical findings

Do not use that line:

- for `/ai-review`
- for medium-only or low-only findings
- in inline comments

Presentation rules for that failure line:

- it must include the wizard or staff-style Gandalf identity icon at the title line
- the phrase `YOU SHALL NOT PASS!` should be fully uppercase for dramatic emphasis
- it should appear only in the top-level Gandalf-mode failure summary, not in acknowledgements or inline findings

## Final Summary Copy Matrix

These templates define the approved top-level summary-note variants for the first
implementation pass.

The existing severity table and findings list remain in place underneath these
openings.

### Matrix key: `mode = gandalf`, `verdict = APPROVE`

#### Variant A

```md
## 🧙 The road is clear

I have walked this change from end to end and found no fault grave enough to bar its passage. The work appears sound, and the craft holds.
```

#### Variant B

```md
## ✅ A worthy piece of craft

I found no issue here that rises to the level of warning. This change may pass onward in peace.
```

#### Variant C

```md
## 🕯️ No shadow worth naming

I looked for the hidden crack, the loose stone, and the danger behind the fair surface. None showed themselves strongly enough to trouble the merge.
```

#### Optional atmospheric sub-line

```md
> _The work holds._
```

### Matrix key: `mode = gandalf`, `verdict = NEEDS_DISCUSSION`

#### Variant A

```md
## 💬 There is mist upon the road

I do not see a clear failure, but neither is the path wholly settled. A few points deserve discussion before this change goes further.
```

#### Variant B

```md
## 🧙 Counsel is needed

There are signs here that merit a closer word among the company. I would not forbid the road, but I would not walk it blind.
```

#### Variant C

```md
## 🕯️ The matter is not yet plain

I have found questions that deserve thought before judgment hardens into certainty. Better a short pause now than trouble later.
```

#### Optional atmospheric sub-line

```md
> _The signs are mixed, and the road is not yet plain._
```

### Matrix key: `mode = gandalf`, `verdict = REQUEST_CHANGES`, `severity includes high or critical`

#### Canonical Variant A

```md
## 🧙 YOU SHALL NOT PASS!

I found issues serious enough to bar this change in its present form. The danger here is not ornamental; it should be corrected before this work goes forward.
```

#### Variant B

```md
## 🧙 YOU SHALL NOT PASS!

There are faults in this change that cross the threshold from concern into risk. These should be addressed before merge.
```

#### Optional atmospheric sub-line

```md
> _There is shadow in this craft, and it should be named before it spreads._
```

### Matrix key: `mode = gandalf`, `verdict = REQUEST_CHANGES`, `severity limited to medium or low`

This softer failure variant exists only if the implementation later chooses to
distinguish between high/critical rejection and medium-only rejection while still
remaining in Gandalf mode. If Phase P4 does not introduce that distinction yet,
the first pass may omit this variant.

#### Variant A

```md
## ⚠️ The bridge does not hold

I found one or more issues of real consequence. This change should not proceed until the weaknesses below are repaired.
```

This variant is the approved softer fallback if the implementation later decides
to distinguish medium-only rejection from high/critical rejection without using
`YOU SHALL NOT PASS!`.

### Matrix key: `mode = professional`, `verdict = APPROVE`

#### Variant A

```md
## ✅ APPROVE

No material issues were found in this review. The change appears ready to merge.
```

### Matrix key: `mode = professional`, `verdict = NEEDS_DISCUSSION`

#### Variant A

```md
## 💬 NEEDS DISCUSSION

This review found areas that merit clarification or team discussion before merge.
```

### Matrix key: `mode = professional`, `verdict = REQUEST_CHANGES`

#### Variant A

```md
## ⚠️ REQUEST CHANGES

This review found issues that should be addressed before merge.
```

## Best Starter Set

If implementation begins with a minimal first pass rather than the full matrix,
the following templates are the preferred initial set.

### Gandalf acknowledgement: generic

```md
🧙 **GitGandalf has answered the call.**

I will look into this work with a careful eye. What is hidden will be brought into the light.
```

### Gandalf acknowledgement: balrog-themed

```md
🔥 **A bold summons.**

If there is a Balrog in these depths, we shall find where it woke.
```

### Gandalf summary: approve

```md
## ✅ A worthy piece of craft

I have examined this change with care and found no fault grave enough to halt its course. The work appears sound.
```

### Gandalf summary: needs discussion

```md
## 💬 There is mist upon the road

I do not see a clear failure, but some matters are not yet settled enough for easy passage. They deserve discussion before this goes further.
```

### Gandalf summary: request changes

```md
## 🧙 YOU SHALL NOT PASS!

I found issues serious enough to bar this change in its present form. The points below should be addressed before merge.
```

### Professional summary: approve

```md
## ✅ APPROVE

No material issues were found in this review. The change appears ready to merge.
```

### Professional summary: needs discussion

```md
## 💬 NEEDS DISCUSSION

This review found areas that merit clarification or team discussion before merge.
```

### Professional summary: request changes

```md
## ⚠️ REQUEST CHANGES

This review found issues that should be addressed before merge.
```

## Recommended Starter Composition

If the implementation chooses one canonical opening per outcome instead of full
variant rotation, use the following combinations first:

- Gandalf acknowledgement generic: `🧙 **GitGandalf has answered the call.**`
- Gandalf acknowledgement for balrog/shadow suffixes: `🔥 **A bold summons.**`
- Gandalf approve summary: `## ✅ A worthy piece of craft`
- Gandalf needs-discussion summary: `## 💬 There is mist upon the road`
- Gandalf high/critical rejection summary: `## 🧙 YOU SHALL NOT PASS!`
- Professional approve summary: `## ✅ APPROVE`
- Professional needs-discussion summary: `## 💬 NEEDS DISCUSSION`
- Professional request-changes summary: `## ⚠️ REQUEST CHANGES`

Optional atmospheric sub-lines should remain short enough to feel intentional rather than melodramatic.

## Inline Comment Policy

This plan explicitly keeps inline finding comments professional in every mode.

Rationale:

- inline comments are the highest-signal engineering artifact
- they should remain stable, boring, and easy to scan
- personality belongs at the orchestration and summary layers, not in evidence blocks

## Ordered Implementation Plan

## Phase P1 — Trigger Alias Expansion

### Goal

Expand note-trigger recognition from a single hardcoded `/ai-review` prefix to a
configurable alias list while preserving current merge-request event behavior.

### Tasks

- [ ] Add `GANDALF_TRIGGER_ALIASES` to `.env.example` and `src/config.ts`
- [ ] Parse the alias list safely from config
- [ ] Update note-trigger matching in `src/api/router.ts`
- [ ] Implement longest-prefix-first matching
- [ ] Add tests for `/ai-review`, `/gandalf`, and `/git-gandalf`
- [ ] Add tests confirming non-trigger notes are ignored

## Phase P2 — Trigger Context Propagation

### Goal

Derive a typed trigger context from note events and carry it through the runtime
path that needs tone-aware behavior.

### Tasks

- [ ] Introduce `ReviewTriggerContext`
- [ ] Derive `alias`, `mode`, `rawNote`, and `suffix`
- [ ] Attach trigger context to the review path for note-triggered runs
- [ ] Keep merge-request webhook runs on the default professional path unless a
      future plan explicitly changes that

## Phase P3 — Immediate Gandalf Acknowledgement

### Goal

Add an immediate top-level MR reply for Gandalf-mode note triggers.

### Tasks

- [ ] Add a deterministic acknowledgement formatter
- [ ] Add a lightweight suffix-theme recognizer for a small starter vocabulary,
      for example: balrog, shadow, flame, judgment, runes, road, counsel
- [ ] Post the acknowledgement note before the expensive review work completes
- [ ] Log acknowledgement failures as warnings and continue the review
- [ ] Add tests for generic and suffix-sensitive acknowledgement behavior

## Phase P4 — Tone-Aware Final Summary

### Goal

Split final summary-note tone by trigger mode while preserving the existing
review data layout and publication guarantees.

### Tasks

- [ ] Extend summary formatting to accept `professional` or `gandalf` mode
- [ ] Keep the current professional summary as the default for `/ai-review`
- [ ] Add Gandalf-mode intro and outro variants
- [ ] Use `🧙 YOU SHALL NOT PASS!` only for Gandalf-mode failure summaries with
      high or critical findings
- [ ] Keep inline finding formatting unchanged
- [ ] Add tests covering all mode and verdict combinations

## Phase P5 — Documentation, Voice Guide, and Validation

### Goal

Document the personality system so future implementation does not drift into
parody, quote spam, or inconsistent trigger behavior.

### Tasks

- [ ] Document trigger aliases and behavior in README and Getting Started
- [ ] Update agent and human workflow docs with trigger-mode semantics
- [ ] Add a compact Gandalf voice guide to the appropriate documentation surface
- [ ] Run `bun run check`, `bun run typecheck`, and `bun test`
- [ ] Perform plan-phase review before marking the plan complete

## Voice Guide Requirements

Any implementation under this plan should satisfy these constraints.

### Approved Gandalf signals

- patient authority
- brief poetic imagery
- references to shadow, flame, road, watchfulness, burden, counsel, craft
- occasional dry wit
- moral seriousness when danger is real

### Disallowed failure modes

- constant direct quoting from Tolkien or the films
- slapstick wizard jokes
- fake archaic gibberish
- random fantasy noun stuffing
- playful tone inside inline findings
- hidden mode switches that users cannot predict

## Open Design Choices To Resolve During Implementation

These are not blockers for starting the work, but they should be decided early in
implementation.

1. Whether `GANDALF_TRIGGER_ALIASES` should remain a single comma-separated env var or later split into professional and Gandalf-mode alias vars.
2. Whether the immediate acknowledgement should be posted from `src/api/pipeline.ts` or via a small dedicated publisher helper invoked at pipeline start.
3. Whether Gandalf-mode summary formatting should be a flag on `formatSummaryComment()` or a separate formatter.

## Validation Plan

### Automated

- router tests for trigger alias matching
- parser tests for suffix extraction
- publisher tests for immediate acknowledgement content
- publisher tests for tone-aware summary formatting
- regression tests proving inline finding comments remain unchanged and professional

### Manual

1. Trigger a review with `/ai-review` and confirm fully professional behavior.
2. Trigger a review with `/gandalf` and confirm immediate Gandalf-style acknowledgement plus normal review execution.
3. Trigger a review with `/git-gandalf face the balrog` and confirm the acknowledgement reflects the suffix.
4. Produce a high-severity failing review in Gandalf mode and confirm the final summary uses `🧙 YOU SHALL NOT PASS!`.
5. Produce the same failing review in professional mode and confirm the summary remains plain.

For manual review of the Gandalf-mode failure summary, verify all of the following:

- the title line uses the Gandalf identity icon
- the phrase is rendered as `YOU SHALL NOT PASS!`
- the rest of the summary remains readable and professional enough for engineering use

## Human Decisions Needed

- None for the initial plan. The core product decisions have already been supplied.
- Future work may expand the personality system beyond acknowledgements and summary-note framing, but that is intentionally out of scope for this first awakening pass.
---
title: "Review Edge Cases Hardening"
status: implemented
priority: high
estimated_hours: 24-40
dependencies:
  - docs/plans/active/git-gandalf-master-plan.md
created: 2026-03-17
date_updated: 2026-03-21

related_files:
  - src/api/router.ts
  - src/api/pipeline.ts
  - src/api/schemas.ts
  - src/context/repo-manager.ts
  - src/gitlab-client/client.ts
  - src/gitlab-client/types.ts
  - src/agents/state.ts
  - src/agents/orchestrator.ts
  - src/publisher/gitlab-publisher.ts
  - tests/repo-manager.test.ts
  - tests/webhook.test.ts
  - tests/publisher.test.ts
  - docs/README.md
  - docs/agents/context/ARCHITECTURE.md
  - docs/agents/context/WORKFLOWS.md
  - docs/humans/context/ARCHITECTURE.md
tags:
  - review-hardening
  - gitlab
  - edge-cases
  - multi-commit
  - idempotency
completion:
  - "# Phase E0 — Immediate Summary Deduplication Guard"
  - [x] E0.1 Add head-SHA-based duplicate guard for automatic same-head reruns before full checkpoint machinery exists
  - [x] Remediation complete — see `docs/plans/review-reports/phase-E0-review-2026-03-18-m3x9.md`
  - "# Phase E1 — Review Trigger Model"
  - [x] E1.1 Introduce typed review trigger context (`automatic` vs `manual`, source event, optional note id)
  - [x] E1.2 Make `/ai-review` always execute a review run even when the current head was reviewed already
  - [x] E1.3 Keep automatic MR events idempotent for already-reviewed heads
  - [x] E1.4 Add tests for auto vs manual trigger behavior
  - [x] Remediation complete — see `docs/plans/review-reports/phase-E1-review-2026-03-18-t7q2.md`
  - "# Phase E2 — Review Checkpointing"
  - [x] E2.1 Persist review-run metadata in GitLab notes using a machine-readable marker
  - [x] E2.2 Record last successful reviewed head SHA and reviewed range start SHA
  - [x] E2.3 Ignore failed or partial runs when computing the next automatic review range
  - [x] E2.4 Add parsers and fixtures for existing/stale review notes
  - [x] Remediation complete — see `docs/plans/review-reports/phase-E2-review-2026-03-20-k9v4.md`
  - "# Phase E3 — Incremental Multi-Commit Review"
  - [x] E3.1 Fetch MR commits and MR versions from GitLab
  - [x] E3.2 Default automatic review scope to the aggregate unreviewed commit range from last successful reviewed head to current head
  - [x] E3.3 Fall back to full current MR review when no prior successful review exists
  - [x] E3.4 Fall back safely when history was rewritten by force-push or rebase
  - [x] E3.5 Skip automatic review when no new code delta exists
  - [x] Remediation complete — see `docs/plans/review-reports/phase-E3-review-2026-03-20-r4m2.md`
  - "# Phase E4 — Publication And Dedupe Semantics"
  - [x] E4.1 Separate “run the review” from “post duplicate findings” behavior
  - [x] E4.2 Prevent automatic duplicate summary notes for the same reviewed head
  - [x] E4.3 Define manual rerun publication behavior for inline findings and summary notes
  - [x] E4.4 Add stale-review detection so older findings do not block newer valid findings
  - [x] Remediation complete — see `docs/plans/review-reports/phase-E4-review-2026-03-21-p6n3.md`
  - "# Phase E5 — Repo Freshness And Concurrency"
  - [x] E5.1 Confirm same-branch cache updates always fetch/reset to latest head before review
  - [x] E5.2 Add per-project+branch locking to prevent concurrent runs from racing on one cached clone
  - [x] E5.3 Add logging for requested branch, fetched head, reviewed range, and cache path
  - [x] E5.4 Add tests for same-branch concurrent trigger behavior
  - [x] E5.5 Decide and implement repo-retention policy after review completion
  - [x] Remediation complete — see `docs/plans/review-reports/phase-E5-review-2026-03-21-f2m8.md`
  - "# Phase E6 — Edge Cases, Docs, And Audit"
  - [x] E6.1 Handle metadata-only MR updates without redundant reviews
  - [x] E6.2 Handle out-of-order webhooks and duplicate delivery safely
  - [x] E6.3 Handle draft/WIP policy explicitly
  - [x] E6.4 Update docs for incremental review semantics and manual override behavior
  - [x] E6.5 Run review-quality validation and plan-phase audit
  - [x] Remediation complete — see `docs/plans/review-reports/phase-E6-review-2026-03-21-h7q4.md`
---

# Review Edge Cases Hardening

## Executive Summary

GitGandalf currently reviews the current MR diff as a whole and has no persistent
concept of what commit range was already reviewed successfully.

That is acceptable for a simple one-shot MR flow, but it breaks down for real
GitLab usage patterns:

- an MR receives multiple pushes over time
- the team wants automatic reviews to cover only the commits that have not been
  reviewed yet
- a human uses `/ai-review` to force a rerun even if the MR was reviewed before
- multiple webhook events arrive for the same MR or the same branch
- branch history can be rewritten by rebase or force-push

This plan hardens GitGandalf’s review lifecycle around those cases.

## Product Goal

### Default behavior

For automatic MR review triggers, GitGandalf should review only the aggregate
code delta that has not yet been reviewed successfully.

That means:

- if no prior successful review exists for the MR, review the full current MR
- if prior successful reviews exist, review from the last successfully reviewed
  head commit forward to the latest MR head commit
- review the aggregate unreviewed range up to latest head, not each intermediate
  commit as an isolated snapshot

### Manual behavior

For `/ai-review`, GitGandalf should always execute a new review run even if the
current MR head was already reviewed.

This is a manual override path.

The important distinction is:

- manual trigger must not be skipped by checkpoint logic
- publication behavior for a manual rerun must be defined explicitly so a rerun
  does not accidentally disappear or spam duplicates

## Why This Matters Now

MR 16 on the target GitLab instance is a concrete example of the problem shape.

Observed from GitLab API:

- source branch: `junie-issue-2-59562`
- target branch: `main`
- current head SHA: `05fef636...`
- MR contains 4 commits and 4 MR versions
- GitLab created a new MR version for each additional commit
- the current review comments and summary are attached to the latest head only

Relevant version history on MR 16:

- version `9816` -> head `366c875b...`
- version `9852` -> head `9674c052...`
- version `9859` -> head `19447d5f...`
- version `9884` -> head `05fef636...`

This is the key architectural insight:

GitLab already exposes the history we need to compute “what changed since the
last reviewed version.”

MR 15 on the same GitLab instance adds the complementary simple-case signal.

Observed from GitLab API:

- source branch: `junie-issue-2-59561`
- current head SHA: `1f573e0d...`
- MR contains a single commit
- GitLab reports two MR versions that point to the same head SHA
- the MR currently contains two identical GitGandalf APPROVE summary notes on the same head

Why this matters:

- duplicate publication is not only a multi-commit problem
- even a simple one-commit MR can accumulate repeated successful summaries when
  the same head is processed more than once
- same-head idempotency and publication dedupe need to be first-class requirements

## Current Behavior And Gaps

### 1. No review checkpoint model

Current pipeline behavior:

- fetch MR metadata
- fetch current MR diff
- clone/update the source branch
- run the three-agent review
- publish findings and a summary note

What is missing:

- no persisted marker for “last successful reviewed head SHA”
- no persisted reviewed range start SHA
- no distinction between failed, partial, and successful review runs
- no concept of automatic vs manual trigger semantics after the router

### 2. Automatic reviews currently target the full current MR diff

Current logic always uses the latest MR diff surface.

That means:

- older already-reviewed changes are reconsidered on every new push
- there is no commit-range narrowing
- the app cannot tell whether a given push is net new review scope or already covered
- same-head duplicate processing can still produce repeated summary notes, as MR 15 demonstrates

### 3. Manual `/ai-review` conflicts with duplicate suppression

Current behavior:

- router accepts `/ai-review` on MR notes and launches the pipeline
- publisher suppresses duplicate inline comments by marker/body match
- summary comments always append and are not deduped or version-aware

Result:

- manual reruns execute, but the publication result is inconsistent
- inline findings may be skipped as duplicates
- summary notes may be repeated even when the head SHA is unchanged
- automatic duplicate runs can also repeat summary notes on unchanged heads

### 4. Repo freshness is partially solved, but only partially

Recent fix:

- repo cache is now scoped by project + branch rather than only project
- branch refresh uses explicit fetch refspec + hard reset to `origin/<branch>`

What still needs hardening:

- same-branch concurrent runs can still race on the same cached path
- we do not yet log enough branch/head information to prove which exact commit
  was reviewed in each run

### 5. No out-of-order or rewritten-history strategy

Current logic assumes a linear, friendly webhook world.

Missing cases:

- merge request update arrives after a newer update was already processed
- same webhook is delivered twice
- source branch is rebased or force-pushed
- title/description-only updates trigger unnecessary code review
- the same head SHA can appear through more than one GitLab MR version record or event path

## Locked Design Direction

The plan treats the following as the intended product direction.

### Review scope model

- automatic MR events review only the aggregate unreviewed code range
- the review target is the current head state, not each intermediate commit state
- if no trusted prior review checkpoint exists, fall back to full current MR review

### Manual override model

- `/ai-review` always launches a review run
- manual review is not blocked by “already reviewed this head” logic
- manual publication semantics must be explicit and testable

### Freshness model

- same-branch reviews must always operate on the latest fetched head
- cache reuse is allowed only if the branch is refreshed before review
- same-branch parallel runs must be serialized or otherwise made safe

## Proposed Architecture

## 1. Introduce typed review trigger context

Add an internal trigger model that survives past the router boundary.

Representative shape:

```ts
type ReviewTriggerMode = "automatic" | "manual";

interface ReviewTriggerContext {
  mode: ReviewTriggerMode;
  source: "merge_request_event" | "mr_note_command";
  noteId?: number;
  rawCommand?: string;
}
```

Why this matters:

- router behavior becomes explicit rather than inferred later
- checkpoint selection can branch on automatic vs manual mode
- publisher can make manual rerun decisions intentionally

## 2. Add a machine-readable review-run ledger in GitLab notes

GitGandalf needs durable, MR-local state without introducing a database.

The simplest durable store is GitLab notes with hidden machine-readable markers.

Recommended marker concept:

```text
<!-- git-gandalf:review-run
format_version=1
status=success
trigger=automatic
range_start_sha=19447d5f...
range_end_sha=05fef636...
mr_version_id=9884
published_inline=true
published_summary=true
-->
```

Required properties:

- format version (always `1` for v1 markers)
- review run id
- trigger mode
- source event kind
- reviewed range start SHA
- reviewed range end SHA
- MR version id used for diff selection
- success/failure/partial status
- timestamp

Why this matters:

- GitGandalf can identify the last successful review checkpoint for the MR
- failed runs do not accidentally advance the checkpoint
- the system remains self-contained in GitLab

## 3. Compute automatic review range from last successful checkpoint

For automatic triggers:

1. fetch MR commits and MR versions
2. fetch GitGandalf review-run metadata from prior notes
3. find the most recent successful checkpoint whose reviewed end SHA is still
   valid in current MR history
4. if found and older than current head, review from that checkpoint end SHA to current head
5. if not found, review the full current MR
6. if checkpoint end SHA equals current head, skip the automatic review

Important nuance:

- do not review each new commit individually
- review the aggregate delta from last reviewed head to latest head

This avoids commenting on transient broken states that already disappeared in the
final head.

## 4. Use GitLab history surfaces intentionally

GitLab gives two relevant history views:

- MR commits
- MR versions

MR versions are especially useful because they map pushes to user-visible MR diff states.

Implementation options to evaluate:

### Option A: MR versions as primary range boundary

Use the previous successful reviewed head SHA and the current version’s head SHA to
select the unreviewed range.

Pros:

- aligns with GitLab’s MR UI model
- makes “compare with previous version” semantics intuitive

Cons:

- may require additional GitLab API methods not currently wrapped

### Option B: repository compare by SHA

Use source repository compare from `lastReviewedHeadSha` to `currentHeadSha`.

Pros:

- explicit commit-range review target
- naturally supports “all commits since last reviewed head”

Cons:

- must validate that diff line numbers still anchor correctly against the latest
  MR diff refs when publishing inline comments

Plan direction — committed decision (resolves pre-implementation review B1):

Use **Option B** (repository compare by SHA) as the analysis scope boundary, but anchor
all inline comment publication to the current MR diff refs unchanged.

Specifically:

- the LLM receives analysis context scoped to `lastReviewedHeadSha..currentHeadSha` —
  the agent is instructed to focus on changes introduced in those commits only
- inline finding publication uses the existing publisher anchoring logic — `baseSha`,
  `headSha`, `startSha` from `mrDetails` remain unchanged
- a finding from the partial review range that does not resolve to a publishable line in
  the current head diff is silently skipped for inline publication — the existing
  `resolveInlineLine` / non-diff-anchoring path already handles this correctly
- no changes to `createInlineDiscussion` or the diff-position anchor logic are required

This is safe because findings from the new commit range are by definition present in the
current head state. Option A (MR versions as primary diff surface) is deferred — it
requires changing the `createInlineDiscussion` position refs and is not needed to get
incremental review working correctly.

## 5. Separate execution policy from publication policy

This is essential.

Current code effectively ties them together too tightly.

We need two separate decisions:

### A. Should a review run execute?

- automatic: only if a new unreviewed code range exists
- manual: always yes

### B. What should be published?

- inline findings
- summary note
- optional checkpoint note or checkpoint metadata embedded into summary note

Recommended publication policy:

- automatic same-head reruns should be skipped entirely
- manual reruns should always produce a new summary note or update path that makes
  the rerun visible to the user
- manual reruns should not blindly spam identical inline findings unless the product
  explicitly wants that behavior

MR 15 strongly supports the first rule above. It already has two identical APPROVE
summary notes for the same head SHA, which is noise and makes the review history
look less trustworthy.

This is the right default because it honors the manual request without turning
every rerun into duplicate inline noise.

## 6. Same-branch freshness and concurrency

### Freshness

Current branch-scoped cache update logic should fetch/reset to latest head on each run.

That means GitGandalf should not stay stale across sequential runs on the same branch,
assuming the fetch succeeds.

Required hardening:

- log requested branch
- log expected current head SHA from GitLab
- log post-fetch local HEAD SHA
- fail loudly if local HEAD does not match expected head SHA before review starts

### Concurrency

Current risk:

- two runs against the same project+branch can overlap on one cache path

Required hardening:

- add per-project+branch mutexing in-process
- optionally add future distributed lock if multi-instance deployment is introduced later

## 7. Checkpoint advancement rules

Only advance “last reviewed” state when the run is truly complete enough to trust.

Recommended rule:

- advance checkpoint only when review execution completed and publication reached a
  defined success threshold

At minimum, do not advance on:

- clone/fetch failure
- LLM failure
- parser failure
- partial pipeline crash before summary publication

Open implementation choice:

- whether inline comment publication failures should still allow checkpoint advance
  if the summary note was posted successfully

This should be decided deliberately during implementation.

## Edge Cases To Handle Explicitly

### 1. Force-push or rebase rewrites history

If the previously reviewed head SHA is no longer an ancestor or present in the MR commit set:

- do not trust incremental review state
- fall back to full current MR review
- mark the run as history-rewritten in logs and metadata

### 2. Duplicate or out-of-order webhooks

If the same head SHA is delivered multiple times:

- automatic triggers should no-op after the first successful review
- manual `/ai-review` should still run

MR 15 indicates this is not hypothetical. A same-head duplicate path already led
to duplicate APPROVE summaries.

If an older webhook arrives after a newer head was already reviewed:

- skip it based on current MR head and checkpoint comparison

### 3. Metadata-only updates

MR title, description, assignee, or label changes should not trigger a full code
review rerun unless a manual command requests it.

### 4. Manual rerun on already-reviewed head

This must still run.

The unresolved product question is publication behavior:

- summary note only
- summary + refreshed inline comments
- summary + only net-new inline deltas compared with prior findings

The recommended default for first implementation is:

- always post a visible summary for manual rerun
- keep inline duplicate suppression unless the finding changed materially

### 5. Concurrent automatic and manual triggers

If a manual `/ai-review` arrives while an automatic review for the same head is already in flight:

- avoid racing two independent reviews on the same branch cache
- ensure at most one run publishes for a given run policy at a time

### 6. Stale prior findings from older heads

Older GitGandalf inline notes should not suppress valid new findings on later heads
just because the body marker matches.

Duplicate detection must become review-version-aware.

### 7. Partial publish failures

If some inline notes fail but others succeed:

- define whether the checkpoint advances
- define whether a retry should re-attempt only missing findings or the whole publication set

### 8. Empty diff range

If the computed automatic unreviewed range has no code changes:

- skip review cleanly
- optionally log a no-op event rather than posting anything

### 9. Draft/WIP MRs

Current behavior does not treat draft status specially.

This plan should make the policy explicit:

- continue reviewing drafts
- or skip automatic review for drafts and allow manual override

This must be chosen intentionally and documented.

### 10. Same head, different GitLab version ids

GitLab may expose multiple version records for what is effectively the same head SHA.

That means review checkpointing must key primarily on reviewed head SHA and only
secondarily on MR version id.

If the logic keys only on version id, it can treat the same code state as new work
and publish duplicate reviews.

### 11. Approved no-change reruns

An unchanged MR with no findings should not accumulate identical APPROVE summaries
from automatic triggers.

Manual rerun behavior can be different, but automatic unchanged-head approval spam
should be prevented.

### 12. Cleanup timing after review completion

If the repo clone is deleted immediately after a run completes, any follow-up retry,
manual rerun, or rapid subsequent push loses the warm cache and must reclone.

This is not inherently wrong, but the retention strategy must be chosen intentionally.

## Proposed Implementation Phases

## Phase E0 — Immediate summary deduplication guard

Stop the live production bleed of duplicate summary notes before full checkpoint
machinery is built. This phase unblocks E1–E3 without requiring the complete
checkpoint system to exist first.

Context: MR 15 already has two identical APPROVE notes. Every review run during
the E1–E3 window adds another one. This phase is a surgical minimum fix.

Deliverables:

- In `src/api/pipeline.ts`: after `getMRDetails()`, fetch existing MR notes for
  automatic triggers and check whether any existing GitGandalf summary note embeds
  the same `headSha` as the current run; if found, skip the review before diff fetch,
  repo refresh, or agent execution and log at info level with the existing note id.
- Embed `headSha` in the summary note body as a hidden HTML comment:
  `<!-- git-gandalf:head sha=<headSha> -->` appended after the visible content but
  before the closing `---` footer. The early automatic-skip check reads this field.
- Do not add the full checkpoint marker yet — that is E2's responsibility.
- Add tests that verify: (1) automatic same-head reruns skip before review execution;
  (2) manual reruns on the same head do not skip.
- Update `WORKFLOWS.md` to note that duplicate-prevention now happens at pipeline
  start for automatic triggers, while completed review runs still post a summary.

Docs to update: `docs/agents/context/WORKFLOWS.md`

## Phase E1 — Review trigger model

Introduce typed trigger context and carry it into the pipeline.

Deliverables:

- New file `src/api/trigger.ts`: define `ReviewTriggerMode` (`"automatic" | "manual"`)
  and `ReviewTriggerContext` (`{ mode, source, noteId?, rawCommand? }`).
- `src/api/router.ts`: build a `ReviewTriggerContext` for each accepted event before
  calling `runPipeline`. Pass it as a second argument: `runPipeline(event, trigger)`.
  For `merge_request` events set `mode: "automatic"`, `source: "merge_request_event"`.
  For `note` events set `mode: "manual"`, `source: "mr_note_command"`,
  `noteId: event.object_attributes.id`, `rawCommand: event.object_attributes.note`.
- `src/api/pipeline.ts`: accept `trigger: ReviewTriggerContext` as second parameter;
  thread it into pipeline context and logging.
- `src/agents/state.ts`: add `triggerContext: ReviewTriggerContext` to `ReviewState`.
- Tests in `tests/webhook.test.ts`: verify that a `merge_request` event produces
  `mode: "automatic"` and a `note` event produces `mode: "manual"`; verify that
  pipeline is still called in both cases.
- Update `WORKFLOWS.md` webhook flow section to document the trigger context.

Docs to update: `docs/agents/context/WORKFLOWS.md`

## Phase E2 — Review checkpointing

Introduce machine-readable review-run metadata in GitLab notes and fetch
discussions once per pipeline run (not once at checkpoint-read time and again at
publication time).

Deliverables:

- Define the checkpoint marker format in a new file `src/publisher/checkpoint.ts`.
  Include `format_version=1` as the first field. Always write `format_version` so
  parsers can version-gate future format changes. Treat a missing `format_version`
  as `0` (legacy, silently ignore).
- Write a `parseCheckpointMarker(noteBody: string): CheckpointRecord | null` function
  that extracts and validates marker fields. Validate all fields with Zod:
  - `format_version`: `z.literal("1")`
  - `status`: `z.enum(["success", "failed", "partial"])`
  - `trigger`: `z.enum(["automatic", "manual"])`
  - `range_start_sha`, `range_end_sha`: `z.string().regex(/^[0-9a-f]{40}$/)`
  - `mr_version_id`: `z.coerce.number().int().positive()`
  - `published_inline`, `published_summary`: `z.enum(["true", "false"])`
  - `run_id`: `z.string().min(1)`
  - `timestamp`: `z.string().datetime()`
  Malformed or partially-valid markers must be silently ignored — never partially
  trusted. This is a security requirement: any MR participant can post a note that
  matches the marker format (R2 finding).
- Embed the checkpoint marker inside the summary note body (after visible content,
  before the `---` footer) rather than posting a separate GitLab note. This means one
  API write per run and no extra clutter in MR discussion thread. Update
  `formatSummaryComment` and `postSummaryComment` to accept and embed checkpoint data.
- Add `getCheckpointRecord(projectId, mrIid): Promise<CheckpointRecord | null>` to
  `GitLabClient`. This method fetches MR notes and searches for the most recent valid
  successful checkpoint marker. **Load discussions once** at the start of the pipeline
  after the `getMRDetails` + `getMRDiff` parallel fetch, store them in `ReviewState` or
  pass them through the pipeline, and reuse the same object in E2 checkpoint read, E4
  inline-duplicate check, and E0 summary guard. This eliminates the double-fetch
  latency (R5 finding).
- Record checkpoint only when run is truly complete: do not write a `status=success`
  checkpoint on clone failure, LLM failure, parse failure, or crash before summary
  publication. Partial/failed runs write `status=failed` or `status=partial` and are
  excluded when selecting the last valid checkpoint.
- Add fixtures for: valid checkpoint marker, marker with missing fields, marker with
  invalid SHA format, marker with wrong format_version, marker from a failed run.
- Test: `parseCheckpointMarker` ignores all malformed variants; picks the most recent
  success over an older one; ignores failed-run markers.
- Operational note (O5): to reset all checkpoints on an MR, delete the GitGandalf
  summary note(s) containing `git-gandalf:review-run` blocks via the GitLab API or UI.
  The next automatic trigger falls back to full review. Document this in a comment
  inside `checkpoint.ts`.

Docs to update: `docs/agents/context/ARCHITECTURE.md` (add "Review Ledger" subsection),
`docs/agents/context/WORKFLOWS.md` (checkpoint write/read flow)

## Phase E3 — Incremental multi-commit review

Teach GitGandalf how to review only the unreviewed aggregate delta.

**Prerequisite**: E3.1 must be complete before E3.2–E3.5 can begin. Implement and test
E3.1 with real API calls before starting E3.2 (O4 finding).

Deliverables:

- E3.1: Add `getMRCommits(projectId, mrIid): Promise<MRCommit[]>` and
  `getMRVersions(projectId, mrIid): Promise<MRVersion[]>` to `GitLabClient`.
  Before shipping, verify that gitbeaker v43's method for each resource returns all
  results, not just the first page. If `.all()` is not available for those resources,
  implement a manual pagination loop with `{ perPage: 100 }` and accumulate pages.
  Add a test that fetches a multi-commit MR and asserts the full commit count (R6
  finding).
- E3.2: Implement `selectReviewRange(checkpoint, mrCommits, currentHeadSha)` in a new
  file `src/agents/review-range.ts`. Returns `{ rangeStart: string, rangeEnd: string,
  mode: "full" | "incremental" | "skip" }`.
  - `"skip"` when checkpoint end SHA equals current head SHA
  - `"full"` when no valid checkpoint exists
  - `"incremental"` when checkpoint end SHA is in `mrCommits` and not the current head
- E3.4: History-rewrite detection must use the GitLab `mrCommits` list, not local git
  ancestry commands. If `lastReviewedHeadSha` does not appear in the SHA list returned
  by `getMRCommits()`, treat it as rewritten history and fall back to `"full"` mode. Do
  not use `git merge-base --is-ancestor` or any local ancestry check — these fail
  silently on `--depth 1` shallow clones and will never find the ancestor (R3 finding).
- E3.2–E3.5: Pass `ReviewRange` into `ReviewState` and thread it into the LLM analysis
  context (investigator system prompt section) so the agent focuses only on the delta.
  Publication uses current MR diff refs unchanged — no changes to `createInlineDiscussion`
  position logic are needed (B1 resolution).
- Tests using MR-16-like version histories (4 commits, incremental range selection) and
  MR-15-like histories (same head, skip detection).

Docs to update: `docs/agents/context/ARCHITECTURE.md` (review range selector),
`docs/agents/context/WORKFLOWS.md` (incremental review flow)

## Phase E4 — Publication and dedupe semantics

Redesign duplicate suppression with review-version awareness. Note: basic summary
duplicate prevention for automatic same-head reruns is handled in E0 and should be shipped first — this phase completes
the full version-aware dedupe model.

Deliverables:

- Version-aware inline finding duplication: `isDuplicate` in `gitlab-publisher.ts`
  must not suppress findings from a *newer* head just because a note from an *older*
  head has a matching marker. Add `headSha` to the duplicate check: only suppress if
  the existing note's position `headSha` matches the current run's `headSha` (or if
  the finding is in a still-unchanged file/line).
- Summary-note publication policy: automatic same-head duplicate prevention is now
  driven by the E0 pipeline-start guard plus E2 checkpoint data; E4 is responsible
  for completing the policy for manual reruns while keeping summary-note posting
  unconditional for completed runs.
- Explicit manual rerun publication behavior: `postInlineComments` receives
  `triggerMode`; in manual mode, suppress inline duplicates only for findings whose
  marker + position exactly matches an existing note at the *same head SHA*. In
  automatic mode, suppress all body-marker matches.
- Tests for: repeated automatic `/ai-review` on same head — only one summary note;
  repeated manual `/ai-review` on same head — summary always posted; stale finding
  from old head does not suppress valid finding on new head.

Docs to update: `docs/agents/context/WORKFLOWS.md` (publication policy)

## Phase E5 — Repo freshness and concurrency

Harden the repo cache around same-branch reruns.

Deliverables:

- In-process per-branch lock that spans the **full pipeline** from `getMRDetails` call
  through checkpoint write, not just the `RepoManager` call. The lock must be acquired
  before MR metadata is fetched, so that the second concurrent run for the same branch
  re-fetches fresh MR metadata after the first run's checkpoint is written (R4 finding).
  Implement as a `Map<string, Promise<void>>` keyed by `"{projectId}-{branch}"` in
  `src/api/pipeline.ts`. Each run chains onto the previous promise for the same key.
- After a successful `cloneOrUpdate`, call `utimes(repoPath, now, now)` (from
  `node:fs/promises`) to explicitly bump the directory mtime. This prevents active
  repos from being evicted by TTL cleanup when git internal operations do not update
  the directory's own mtime on the target filesystem (O2 finding).
- Log at `debug` level: requested branch, expected head SHA from GitLab, post-fetch
  local HEAD SHA. Fail loudly (`throw`) if post-fetch local HEAD does not match the
  expected `mrDetails.headSha`.
- Race-condition tests: two simulated pipeline calls for the same branch resolve
  sequentially, not concurrently.

Docs to update: `docs/agents/context/ARCHITECTURE.md` (concurrency model, mtime fix),
`docs/agents/context/WORKFLOWS.md` (concurrency note)

## Phase E6 — Edge cases, docs, and audit

Finish policy edges, complete documentation, and perform final audit.

Deliverables:

- Duplicate webhook handling: if automatic trigger arrives for a head SHA already in a
  successful checkpoint, log and skip before calling `runReview`.
- Metadata-only update handling: in `src/api/router.ts`, detect `update` events where
  `oldRev == newRev` (if GitLab provides it) or compare head SHA from event with
  checkpoint; if head unchanged and no new commits, return `200 Ignored`.
- Explicit draft/WIP policy: read `draft` / `work_in_progress` from
  `mergeRequestAttributesSchema` (already present); default is **review drafts unless
  configured otherwise** — document this choice.
- Per-phase docs audit: verify `ARCHITECTURE.md` and `WORKFLOWS.md` cover trigger
  context (E1), checkpoint format and ledger (E2), incremental review flow (E3),
  version-aware dedupe (E4), concurrency model (E5). This is the final review of all
  doc updates that should have been applied incrementally during E1–E5 (R7 finding).
- Final review-quality audit: run `review-plan-phase` skill against all phases before
  marking plan complete.

## Testing Strategy

At minimum, add coverage for:

- first review on an MR with no prior checkpoint
- automatic review after one new commit
- automatic review after multiple new commits since last checkpoint
- same-head automatic duplicate webhook
- same-head manual `/ai-review` rerun
- force-push invalidating old checkpoint
- stale inline note markers from older heads
- automatic same-head skip and summary publication behavior
- same-branch concurrent trigger race
- metadata-only MR update

Add a more explicit test matrix by subsystem.

### Router and trigger tests

- automatic MR event on never-reviewed head -> runs
- automatic MR event on already-reviewed head -> skips
- manual `/ai-review` on already-reviewed head -> runs
- manual `/ai-review` with existing identical findings -> summary remains visible and inline publication follows policy
- duplicate webhook deliveries for the same head -> automatic path remains idempotent

### GitLab history and checkpoint tests

- parse last successful review marker from MR notes
- ignore malformed or incomplete review markers
- ignore failed review markers when selecting checkpoint
- choose the most recent valid successful checkpoint
- same head SHA with multiple MR version ids does not trigger duplicate automatic reviews
- rewritten history invalidates old checkpoint and falls back to full review

### Review-range selection tests

- one-commit MR with no prior checkpoint -> full review
- multi-commit MR with one prior checkpoint -> review from last reviewed head to current head
- multi-commit MR with several unreviewed commits -> single aggregate range to latest head
- no net-new code delta -> skip automatic review
- metadata-only update with unchanged head -> skip automatic review

### Publisher and dedupe tests

- automatic same-head rerun skips before posting a second summary note
- automatic same-head rerun does not repost identical inline findings
- manual same-head rerun posts a visible summary note
- stale findings from an older head do not suppress valid findings on a newer head
- identical APPROVE summary on the same head is prevented by automatic-run skipping

### Repo-manager and freshness tests

- same branch fetch/reset moves local clone to expected current head before review
- same project different branch caches remain isolated
- same project same branch concurrent triggers are serialized
- failed fetch/reset does not advance checkpoint
- optional cleanup path behaves correctly under immediate rerun after completion

### End-to-end lifecycle tests

- MR lifecycle resembling MR 16: multiple successive pushes, then automatic incremental review
- MR lifecycle resembling MR 15: single commit, duplicate same-head trigger, only one automatic APPROVE summary remains
- manual rerun after successful automatic review on same head
- force-push after prior review resets range selection safely

These tests should be treated as required coverage for the plan, not optional follow-up.

## Repo Deletion Tradeoffs After Review Completion

One design question is whether GitGandalf should delete the cloned repo from disk
immediately after a review completes and the end note is posted.

### Benefits of immediate deletion

- saves disk space aggressively
- removes stale working copies immediately rather than waiting for TTL cleanup
- lowers the chance of old cached repos lingering indefinitely if cleanup does not run often
- reduces long-lived on-disk exposure of source code in the cache directory

### Downsides of immediate deletion

- loses the warm cache for quick follow-up pushes on the same branch
- makes manual `/ai-review` reruns more expensive because every rerun reclones
- increases GitLab traffic and clone latency during active MR iteration
- makes concurrency and retry handling trickier if a follow-up run starts while cleanup is happening
- removes useful local artifacts for debugging a failed or suspicious review run

### Operational tradeoff

GitGandalf is a webhook-driven reviewer, not a long-lived code workspace. That argues
for bounded retention rather than indefinite caching.

But immediate deletion is usually too aggressive for active MR workflows because:

- developers often push multiple commits close together
- manual reruns are a supported workflow
- branch-scoped cache reuse is now part of the freshness model

### Recommended first-pass policy

- do not delete the clone immediately after every successful review
- keep branch-scoped cache with TTL-based cleanup as the default
- shorten TTL if disk pressure or code-retention policy requires it
- add explicit cleanup on terminal states later if desired, for example when an MR is merged or closed

This gives the best balance between:

- space savings
- review latency
- retry ergonomics
- debugability

If the team wants more aggressive cleanup later, the safer evolution is:

1. keep TTL cache now
2. add metrics on cache hit rate and disk usage
3. then evaluate whether immediate deletion or shorter TTL actually improves operations

## Recommended First Implementation Choices

To keep the first pass manageable, the plan recommends these defaults:

1. For automatic reviews, skip if the latest head SHA already has a successful checkpoint.
2. For automatic reviews, when new commits exist, review the aggregate delta from the
   last successful reviewed head SHA to the current head SHA.
3. For manual `/ai-review`, always run the review.
4. For manual reruns, always publish a visible summary note.
5. For manual reruns, keep inline duplicate suppression unless the finding changed materially.
6. For rewritten history, fall back to full current MR review.
7. For same-branch cache access, add in-process locking.
8. Keep branch-scoped cached clones with TTL cleanup instead of deleting them immediately after each review.

## Open Product Questions

These do not block the plan file, but they should be answered during implementation.

### 1. Manual rerun inline behavior

Should `/ai-review` on an unchanged head:

- post only a new summary note
- repost inline findings as fresh notes
- update/resolve prior GitGandalf notes instead of reposting

### 2. Checkpoint advance threshold

If inline comment publication partially fails but the review itself completed,
should the successful review checkpoint still advance?

### 3. Draft/WIP policy

Should draft MRs be reviewed automatically, or only manually?

## Pre-Implementation Review Verdict

**Reviewed**: 2026-03-18  
**Verdict**: 🟡 CONDITIONAL — E1 and E2 may begin; E3 must not start until B1 is resolved
(resolution is now embedded in the Architecture section above).

**Findings**: 1 BLOCKER · 7 RISK · 5 OPTIMIZATION

### BLOCKERs

#### B1: Incremental diff anchor strategy was unresolved

- **Status**: ✅ Resolved in this document (see Architecture section 4 "Plan direction")
- **Summary**: The plan originally deferred the inline-anchor choice to "an implementation
  spike." Without a committed answer, E3 could silently drop all incremental inline
  findings. The committed resolution is: Option B (SHA range for analysis scope) +
  current MR diff refs for publication — no changes to `createInlineDiscussion` needed.

---

### RISKs

#### R1: E4 deduplication arrives too late — duplicate summaries accumulate during E1–E3

- **Status**: ✅ Resolved — Phase E0 added as a pre-phase implementing a minimum
  head-SHA guard in `postSummaryComment` before the full checkpoint system exists.

#### R2: Checkpoint marker content is external data but no Zod validation schema was specified

- **Status**: ✅ Resolved — Phase E2 now explicitly requires Zod schemas for all
  marker fields; malformed markers are silently ignored, never partially trusted.

#### R3: Force-push ancestry detection will fail on `--depth 1` shallow clones

- **Status**: ✅ Resolved — Phase E3.4 now explicitly prohibits local `git merge-base`
  ancestry checks and requires using the GitLab `getMRCommits()` list instead.

#### R4: In-process per-branch lock must cover the full pipeline, not just `RepoManager`

- **Status**: ✅ Resolved — Phase E5 now specifies that the lock is acquired before
  `getMRDetails`, spans through checkpoint write, and is implemented in `pipeline.ts`.

#### R5: Two separate fetches of MR discussions — checkpoint read and inline-duplicate check

- **Status**: ✅ Resolved — Phase E2 now specifies loading discussions once at pipeline
  start and threading the result through to both checkpoint-read and publication.

#### R6: Gitbeaker pagination support for `getMRVersions` / `getMRCommits` not verified

- **Status**: ✅ Resolved — Phase E3.1 now requires verifying pagination behavior before
  starting E3.2, with an explicit fallback pagination loop if `.all()` is unavailable.

#### R7: Documentation updates deferred entirely to E6

- **Status**: ✅ Resolved — each phase (E0–E5) now lists specific docs to update within
  that phase. E6 audits completeness rather than owning all documentation.

---

### OPTIMIZATIONs

#### O1: Embed checkpoint metadata in summary note body instead of a separate note

- **Status**: ✅ Resolved — Phase E2 now specifies embedding the checkpoint block inside
  the summary note body, one write per run, no extra MR thread clutter.

#### O2: TTL mtime cleanup may evict actively-used repos

- **Status**: ✅ Resolved — Phase E5 now adds `utimes(repoPath, now, now)` after every
  successful `cloneOrUpdate` to explicitly refresh directory mtime.

#### O3: Checkpoint marker format has no version field

- **Status**: ✅ Resolved — `format_version=1` added as the first field in the marker
  format; parsers treat a missing version as `0` (legacy, ignore).

#### O4: E3 task ordering is implicit

- **Status**: ✅ Resolved — Phase E3 now opens with an explicit prerequisite note:
  E3.1 (GitLab client methods) must be complete before E3.2–E3.5 begin.

#### O5: No rollback strategy if checkpoint format has a bug

- **Status**: ✅ Resolved — Phase E2 now includes an operational note: delete the
  GitGandalf summary note(s) containing `git-gandalf:review-run` blocks via the
  GitLab API or UI to reset; next automatic trigger falls back to full review.

---

## Success Criteria

This plan is complete when GitGandalf can:

- automatically review only unreviewed commit ranges on multi-commit MRs
- always rerun on `/ai-review`
- avoid redundant automatic reruns for the same head
- survive duplicate and out-of-order webhooks
- remain fresh on the latest branch head
- avoid same-branch cache races
- make review checkpoints auditable from GitLab notes alone

If those conditions are not met, GitGandalf will still behave like a stateless
single-shot reviewer, which is not sufficient for a real MR lifecycle.
## Plan Review: Review Edge Cases Hardening — Phase E0

**Plan file**: `docs/plans/active/review-edge-cases-hardening.md`
**Reviewed against**: AGENTS.md, docs/agents/context/ARCHITECTURE.md, docs/agents/context/WORKFLOWS.md, active plans
**Verdict**: 🟢 READY

### Summary

Phase E0 is fully implemented and matches every deliverable in the plan. The head-SHA
deduplication guard is in place in `postSummaryComment`, the hidden marker is embedded
in the summary note body, `getMRNotes()` is correctly added to `GitLabClient`, pipeline
passes the head SHA through, WORKFLOWS.md is updated, and the plan checkbox is marked
done. All 142 tests pass and TypeScript is clean. One Biome formatting deviation
(3 files auto-fixed during this review pass, before being committed) is the only
process-level gap; it is resolved in the working tree.

**Findings**: 0 BLOCKER · 1 RISK · 3 OPTIMIZATION

---

### RISKs

#### R1: E0 dedup guard suppresses summary notes for manual `/ai-review` reruns too

- **Dimension**: Architecture
- **Finding**: `postSummaryComment` applies the head-SHA dedup check unconditionally for
  all callers. A manual `/ai-review` rerun on an already-reviewed head will be silently
  suppressed — no new summary note is posted. The plan's "Recommended First Implementation
  Choices #4" states "For manual reruns, always publish a visible summary note."
- **Impact**: Until E4 differentiates trigger modes, users who issue `/ai-review` on an
  unchanged head receive no summary note and no feedback that the review ran. This
  actively contradicts the stated manual-rerun product requirement.
- **Alternative**: This is an explicitly documented design gap — E4 deliverables
  state "E4 is responsible for completing the policy for manual reruns: manual reruns
  always post a new summary note regardless of head SHA match (the E0 guard skips only
  for automatic mode)." No remediation needed now — **track as a known gap that E4 must
  close**. Add a code comment to `postSummaryComment` noting the limitation so future
  implementers do not miss it.

---

### OPTIMIZATIONs

#### O1: 3 E0 implementation files had Biome formatting violations (auto-fixed during review)

- **Dimension**: Structure
- **Finding**: Running `bun run check` in the review pass auto-fixed 3 files in the
  E0 implementation (the base prior to E0 was Biome-clean per stash verification). The
  violations were not committed as the implementation was never committed, but AGENTS.md
  rule 3 obligates `bun run check` to be run before committing. The working tree is now
  clean.
- **Impact**: Process non-compliance; no behavioral impact since the fixes are applied
  before the commit.
- **Alternative**: `[agent]` No code changes needed — violations are already auto-fixed.
  The commit must be made from the current (clean) working tree state.

#### O2: Missing blank line before HEAD_MARKER in formatted note output

- **Dimension**: Structure
- **Finding**: In `formatSummaryComment`, the `<!-- git-gandalf:head sha=... -->` line is
  pushed immediately after the last finding bullet or "No findings" line with no blank
  line separator. The output reads `- 🔵 **finding** ...\n<!-- git-gandalf:head ... -->`
  without a visual break.
- **Impact**: Cosmetic only — the hidden HTML comment is never visible in rendered
  GitLab Markdown. No functional impact.
- **Alternative**: `[agent]` Add `lines.push("")` immediately before the headSha block:
  ```ts
  if (headSha) {
    lines.push("", `${HEAD_MARKER_PREFIX}${headSha} -->`);  // blank line before marker
  }
  ```

#### O3: No dedicated unit test for `formatSummaryComment` with headSha argument

- **Dimension**: Tests
- **Finding**: The pure `formatSummaryComment` formatter now accepts `headSha?: string`
  and embeds a hidden marker, but none of the `describe("formatSummaryComment")` unit
  tests exercise this code path directly. The behavior is covered indirectly through
  the `GitLabPublisher.postSummaryComment` integration tests ("embeds the head SHA
  marker in the posted body").
- **Impact**: If someone refactors `formatSummaryComment` signature or embedding logic,
  the formatter-level tests won't catch it — breakage would be caught only at the
  integration layer.
- **Alternative**: `[agent]` Add one unit test to the `formatSummaryComment` describe block:
  ```ts
  it("embeds hidden head SHA marker when headSha is provided", () => {
    const body = formatSummaryComment("APPROVE", [], "deadbeefsha");
    expect(body).toContain("<!-- git-gandalf:head sha=deadbeefsha -->");
    expect(body).toContain("---");
    // Marker must appear before the footer separator
    const markerIdx = body.indexOf("<!-- git-gandalf:head sha=");
    const footerIdx = body.indexOf("---");
    expect(markerIdx).toBeLessThan(footerIdx);
  });

  it("omits head SHA marker when headSha is absent", () => {
    const body = formatSummaryComment("APPROVE", []);
    expect(body).not.toContain("<!-- git-gandalf:head sha=");
  });
  ```

---

### Confirmed Strengths

1. **Clean guard implementation** — `postSummaryComment` fetches notes only when `headSha`
   is non-empty, avoiding a wasted API call for the rare case where `diff_refs` is absent.

2. **Lightweight `getMRNotes()` method** — returns `Array<{ id: number; body: string }>`
   instead of full `Note` objects, correctly scoped to the minimum needed for dedup
   checking, with explicit `Number()` and `String()` coercion.

3. **Backward compatibility preserved** — `formatSummaryComment` takes `headSha?`
   (optional), and `postSummaryComment` gracefully skips the dedup logic when headSha is
   empty. Pre-E0 notes without head markers never suppress new posts (tested explicitly
   with "posts when existing note has summary marker but no head SHA (legacy note)").

4. **Test coverage is thorough for a minimum guard** — 6 tests cover: normal post, body
   content, head marker embedding, same-SHA skip, different-SHA post, and legacy-note
   compatibility. The legacy note case is the most important correctness test and is present.

5. **WORKFLOWS.md describes the behavior accurately** — the doc update is precise:
   references both `<!-- git-gandalf:summary -->` and `<!-- git-gandalf:head sha=... -->`
   markers and explains the skip-on-match semantics.

6. **No full checkpoint marker leaked in** — the plan explicitly required E0 NOT to
   embed the full `<!-- git-gandalf:review-run ... -->` block (that is E2's job). The
   implementation correctly limits itself to only the head marker.

---

### Verdict & Remediation Details

🟢 READY — E0 is a complete, correct implementation of the plan phase. The three
optimizations are all minor and can be fixed in a single remediation pass before
committing. No human decisions are required.

R1 is intentional by-plan design and needs only a code comment, not behavioral change.
O1 is already resolved (Biome auto-fixed). O2 and O3 are small improvements that should
be applied before committing given the overall quality standard.

### Ordered Remediation Steps

- [x] **[agent] O1 — Biome format deviations**: Already auto-fixed by `bun run check` during
  this review. No further action needed. Commit from clean working tree.
- [x] **[agent] R1 — Add code comment to `postSummaryComment`**: Added one-line comment noting
  the E4 limitation (`// E4 will add trigger-mode awareness: manual reruns always post`).
- [x] **[agent] O2 — Add blank line before HEAD_MARKER**: In `formatSummaryComment`, push `""`
  before the headSha line so there is a visual separator in the raw Markdown source.
- [x] **[agent] O3 — Add 2 unit tests for `formatSummaryComment` with/without headSha**: Added
  to `describe("formatSummaryComment")` in `tests/publisher.test.ts`.

### Required Validations

- [x] `bun run check` — clean (auto-fixed during review)
- [x] `bun run typecheck` — passes (0 errors)
- [x] `bun test` — 144 pass, 0 fail (2 new `formatSummaryComment` unit tests added by remediation)

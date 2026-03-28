## Plan Review: GitGandalf Master Plan — Phase 4.5 (Jira Read-Only Context Enrichment)

**Plan file**: `docs/plans/active/git-gandalf-master-plan.md`
**Reviewed against**: AGENTS.md, docs/context/ARCHITECTURE.md, docs/context/WORKFLOWS.md, active plans
**Verdict**: 🟡 CONDITIONAL — 1 BLOCKER, 2 RISKs. No human decisions needed. Remediating immediately.

---

### Summary

Phase 4.5 is functionally complete and well-tested: all five plan items are implemented, the Zod boundary
is correct, the ADF parser is spec-conformant, and the 45-test suite is thorough. One BLOCKER is present:
the `promptCache` in `prompt-loader.ts` combined with module-level prompt constants in all three agent files
means prompt changes are never picked up without a process restart — and within `bun run --hot`, the cache
actively suppresses HMR re-reads. This was identified and fixed in the session immediately preceding this
review, then reverted, re-introducing the exact user-reported defect. Two RISKs round out the findings:
a dead alias in the Jira client and a missing evidence-brevity rule in the reflection agent output schema.

**Findings**: 1 BLOCKER · 2 RISK · 0 OPTIMIZATION

---

### BLOCKERs

#### B1: Prompt caching prevents YAML changes from taking effect

- **Dimension**: Architecture
- **Finding**: All three agent modules capture their system prompt at module load time as module-level
  constants: `const CONTEXT_AGENT_SYSTEM_PROMPT = loadAgentPrompt("context_agent")`. This const is
  evaluated once when the module is first imported and never re-evaluated. `prompt-loader.ts` also adds
  an in-memory `promptCache` Map that caches the string the first time `loadAgentPrompt` is called.
  The combined effect: during `bun run --hot` development, when `system-prompts.yaml` changes, Bun
  does not re-evaluate the agent modules (only the changed file triggers HMR), so the module-level
  const remains stale. Even if Bun *did* re-evaluate the agent modules, the `promptCache` would return
  the old string. In production, prompt changes silently require a full process restart — nowhere
  documented. This is the exact defect reported by the user ("I tried to make changes to the system
  prompt but it does not look like it is being picked up") and the fix was already in the codebase
  but was reverted.
- **Impact**: Prompt edits have no effect without a process kill/restart. Developers editing
  `system-prompts.yaml` during active development receive no feedback that their changes are live.
- **Alternative**: Remove the `promptCache` Map from `prompt-loader.ts` AND move the `loadAgentPrompt`
  call from module-level initialization to inside each agent's function body. The YAML is ~3 KB and
  is read on every review invocation — the overhead is negligible relative to a Bedrock API call.

---

### RISKs

#### R1: `jiraIssueResponseLooseSchema` is a dead alias with a misleading name

- **Dimension**: Structure
- **Finding**: `src/integrations/jira/client.ts` declares
  `const jiraIssueResponseLooseSchema = jiraIssueResponseSchema;` immediately after defining
  `jiraIssueResponseSchema`. The alias is identical to the original — no field is loosened,
  no `.passthrough()` call was added at the alias level. The name implies a more permissive variant
  was intended but not implemented. All call sites use `jiraIssueResponseLooseSchema`, making it
  impossible to distinguish the intended strictness from the actual one.
- **Impact**: Future maintainers may attempt to add fields to `jiraIssueResponseLooseSchema` believing
  it is intentionally separate, causing silent divergence, or may add strictness to
  `jiraIssueResponseSchema` not realising both names are the same object.
- **Alternative**: Delete the `jiraIssueResponseLooseSchema` alias. Update all references to use
  `jiraIssueResponseSchema` directly. The `.passthrough()` on the `fields` object already handles
  the looseness needed for custom fields.

#### R2: Reflection agent `output_schema` is missing the evidence brevity rule

- **Dimension**: Docs
- **Finding**: The investigator agent `output_schema` rules include
  `- evidence: one line or a short code quote — no multi-sentence explanation`. The reflection agent
  `output_schema` only specifies `- description: one sentence, max 30 words` — there is no evidence
  brevity rule. The reflection agent re-emits and rewrites findings as the final output consumed by
  the publisher, so it is the most important place to enforce brevity.
- **Impact**: Evidence fields from the reflection agent can be multi-sentence prose, defeating the
  conciseness work applied to the investigator.
- **Alternative**: Add `- evidence: one line or a short code quote — no prose narrative` to the
  reflection agent `output_schema` rules section.

---

### Confirmed Strengths

- **ADF parser**: Full spec-conformant recursive implementation covering all block and inline node
  types. 45 tests, including spec edge cases (hardBreak, inlineCard, mention, emoji, status, date,
  blockquote, expand, rule, mixed multi-block, unknown nodes skipped).
- **Error isolation**: `fetchJiraTicket` never throws; all failures return `null` with a `warn` log.
  `fetchLinkedTickets` returns `[]` when Jira is disabled, so the pipeline always proceeds.
- **Zod boundary**: Raw Jira API response is validated with `jiraIssueResponseSchema.safeParse()`
  before any field is accessed. Custom fields accessed via `.passthrough()` + untyped map access.
- **Bounded blast radius**: `JIRA_MAX_TICKETS` cap, per-ticket `AbortController` timeout, and
  project-key allow-list all correctly implemented and tested.
- **Publisher format improved**: `formatFindingComment` now emits compact `🔴 **Title**` format
  instead of verbose `## 🔴 CRITICAL: Title` with `**Risk**:` / `**Evidence**:` labels.
- **`.env.example`**: All 8 Jira vars documented with comments and correct defaults.

---

### Verdict & Remediation Details

B1 is the root cause of the user-reported defect. It existed before Phase 4.5 but was exposed by
the prompt tuning work done in this session. Phase 4.5 is CONDITIONAL: it ships as correct Jira
enrichment but the agent prompt system has a structural caching bug that must be fixed before the
prompt changes from this session have any real effect.

No human decisions are required. All three findings have deterministic [agent] fixes. Remediating now.

---

### Ordered Remediation Steps

- [ ] **[agent] B1 — Remove promptCache and move loadAgentPrompt to call sites**: In
  `src/agents/prompt-loader.ts`, delete the `promptCache` Map and update `loadAgentPrompt` to call
  `renderPrompt(loadPromptConfig()[promptKey])` directly without caching. In
  `src/agents/context-agent.ts`, `investigator-agent.ts`, and `reflection-agent.ts`, move each
  module-level prompt constant call to inside the agent function body. Completion criterion:
  editing `system-prompts.yaml` while the server is running and triggering a review produces
  comments matching the updated prompt without a restart.
- [ ] **[agent] R1 — Remove `jiraIssueResponseLooseSchema` alias**: Delete the declaration and
  update all uses to `jiraIssueResponseSchema`. Completion criterion: `bun run typecheck` passes,
  no reference to `jiraIssueResponseLooseSchema` remains.
- [ ] **[agent] R2 — Add evidence brevity rule to reflection agent output_schema**: Add
  `- evidence: one line or a short code quote — no prose narrative` to the reflection agent
  `output_schema` rules in `system-prompts.yaml`. Completion criterion: rule present in YAML.

---

### Required Validations

- [ ] `bun run check`
- [ ] `bun run typecheck`
- [ ] `bun test`
- [ ] Documentation references verified (no stale behavior, removed files, or outdated config)

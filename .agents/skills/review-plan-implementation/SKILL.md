---
name: review-plan-implementation
description: >
  Ruthless pre-implementation review of CodeSmith implementation plans. Evaluates
  architecture and data flow, library and runtime choices, security and blast radius,
  resilience and edge cases. Categorizes findings as BLOCKER, RISK, or OPTIMIZATION
  with mandatory actionable alternatives. Use on a plan file before implementation
  begins. If no plan is specified, reviews the most recently created plan.
argument-hint: 'Path to the plan file to review, or omit to review the most recently created plan.'
license: Apache-2.0
---

# Review Plan Implementation

> **Pipeline position**: `plan-implementation` → **`review-plan-implementation`** → `implement`

Use this skill to perform a ruthless, exhaustive evaluation of an implementation plan
**before any code is written**. The goal is to surface architectural bottlenecks,
security flaws, bloated dependencies, missing resilience strategies, and unrealistic
phase structures — not to debate subjective style preferences.

This skill is distinct from `review-plan-phase`, which audits **implemented code**
against a completed plan. This skill audits the **plan itself** for structural,
architectural, and security soundness.

## Outcome

Produce a categorized review report that:
- evaluates every dimension listed in the Review Dimensions section below
- classifies each finding as `BLOCKER`, `RISK`, or `OPTIMIZATION`
- provides a concrete actionable alternative for every finding — no critique without a fix
- delivers a final verdict on whether the plan is ready for implementation
- stops before making changes — the plan author decides what to act on

## When To Use

Use this skill for:
- reviewing a plan produced by `plan-implementation` before committing to implementation
- auditing a manually written plan for architectural soundness
- catching dependency bloat, security gaps, and resilience blind spots before they become code
- validating that a plan is realistic, phased correctly, and complete

Do not use this skill for:
- reviewing already-implemented code — use `review-plan-phase` instead
- writing or modifying the plan — this skill produces a report only
- general code review outside the plan-driven workflow

## Target Plan Resolution

If no plan file is specified:
1. Check for the most recently created or modified plan in `docs/plans/backlog/` and `docs/plans/active/`.
2. Use `git log --diff-filter=A --name-only -- 'docs/plans/'` or file modification timestamps to identify it.
3. Confirm the target plan with the user before proceeding.

If a plan file is specified, use it directly.

## Procedure

### Step 0 — Load Context

1. Read [AGENTS.md](../../../AGENTS.md) in full.
2. Read the target plan file in full.
3. Read [docs/context/ARCHITECTURE.md](../../../docs/context/ARCHITECTURE.md)
  and [docs/context/WORKFLOWS.md](../../../docs/context/WORKFLOWS.md) to
   understand the current system the plan builds on.
4. Read active plans under `docs/plans/active/` to identify conflicts or coordination gaps.
5. If the plan references existing source files, read them to verify the plan's assumptions
   about current behavior are accurate.

### Step 1 — Architecture & Data Flow Review

Evaluate the plan's architectural design for structural soundness.

**Required checks:**

- **System boundaries**: Are module boundaries explicit? Does the plan introduce ambiguous
  ownership between components? Are new modules justified, or do they fragment existing
  cohesive surfaces?
- **State management**: Where is state created, mutated, and consumed? Is mutable shared
  state introduced? Are there race conditions in concurrent paths? Is state flow
  unidirectional or does it create cycles?
- **Synchronous bottlenecks**: Does the plan introduce synchronous operations in
  async-critical paths? Are blocking calls (file I/O, subprocess, network) wrapped in
  appropriate async patterns? Will any phase block the event loop?
- **Data flow completeness**: Trace data from entry (webhook, API, CLI) to exit (GitLab
  comment, log, response). Are there dead-end paths where data is produced but never
  consumed? Are there paths where errors are silently swallowed?
- **Integration seams**: Where the plan connects to existing systems, are the contracts
  explicit? Are there implicit assumptions about the shape of data crossing boundaries?

### Step 2 — Library & Runtime Choices Review

Evaluate every dependency and tooling choice in the plan.

**Required checks:**

- **Runtime nativity**: Are proposed libraries native to the target runtime (Bun)? Are
  Node-specific packages proposed when Bun-native alternatives exist? Does the plan
  introduce polyfills or compatibility layers that the runtime already handles?
- **Dependency weight**: Is the plan adding a large dependency for a task that native
  APIs or a few lines of code can handle? Calculate the cost: install size, transitive
  dependency count, maintenance surface. Flag any dependency where the value delivered
  is disproportionate to its weight.
- **Maintenance health**: Is each proposed library actively maintained? To evaluate:
  1. **Prefer live data**: Use HTTP tools (e.g., `fetch_webpage`) to check the library's
     GitHub repository (stars, last commit date, open/closed issue ratio, contributor count)
     and npm/JSR registry page (weekly downloads, last publish date, version cadence).
  2. **Fallback to best available knowledge**: If HTTP tools are unavailable or the request
     fails, use your training data to assess maintenance health. State when you are relying
     on cached knowledge rather than live data.
  
  Key signals: last release date, open issue count trend, bus factor (single maintainer?),
  TypeScript support quality (first-class types vs. `@types/` bolt-on).
- **License compliance**: Are all proposed dependencies under permissive open-source
  licenses (MIT, Apache-2.0, BSD)? Flag copyleft (GPL, AGPL) or ambiguous licenses.
- **Existing alternatives**: Does the codebase already contain a pattern, utility, or
  abstraction that handles what the new dependency claims to solve? Prefer extending
  existing code over adding external weight.
- **Drop-in upgrades**: If the plan retains an existing dependency, is there a clearly
  superior alternative that is more performant, more secure, actively maintained,
  community-loved, and close to a drop-in replacement?

### Step 3 — Security & Blast Radius Review

Evaluate the plan's security posture with zero tolerance for implicit trust.

**Required checks:**

- **Execution sandboxing**: Does the plan introduce code execution paths (subprocess,
  eval, dynamic import, template rendering) without sandboxing? Are file system
  operations constrained to validated paths with `path.resolve()` + prefix check?
- **Input validation boundaries**: Are all new external data entry points (webhooks,
  API endpoints, environment variables, LLM outputs, file reads from cloned repos)
  validated with Zod? Are there paths where external data crosses a trust boundary
  without validation?
- **Authentication and authorization**: Does the plan handle credentials correctly?
  Are secrets loaded from environment only, never hardcoded or logged? Is the principle
  of least privilege applied to API tokens, file access, and network calls?
- **Blast radius of failure**: If the new feature fails catastrophically, what else
  breaks? Can a failure in one review pipeline corrupt another? Can malformed input
  crash the server or exhaust resources? Is failure isolated to the request?
- **Supply chain risk**: Do new dependencies have known CVEs? Are they from trusted
  publishers? Could a compromised transitive dependency escalate privileges in the
  system?
- **Dependency audit**: If the plan introduces or changes dependencies, run `bun audit`
  in the terminal to check for known vulnerabilities. Include the audit output in the
  report. If `bun audit` is not available or fails, flag this as a manual verification
  step the implementer must perform before merging.
- **SSRF and path traversal**: Does the plan accept URLs, file paths, or repository
  references from external input? Are they validated and restricted to expected domains
  and paths?

### Step 4 — Resilience & Edge Cases Review

Evaluate the plan's failure handling and operational robustness.

**Required checks:**

- **Failure modes**: For each external call (GitLab API, LLM API, Git subprocess, file
  system), what happens on: timeout, 429 rate limit, 500 server error, malformed
  response, empty response, network partition? Are retries bounded? Is there backoff?
- **LLM output handling**: Does the plan account for malformed, partial, or
  hallucinated LLM structured outputs? Is Zod validation applied to LLM responses
  before consumption? What happens when the LLM returns valid JSON with nonsensical
  content?
- **Concurrency and locking**: If the plan introduces concurrent operations on shared
  resources (repo cache, file system, database), is locking or serialization addressed?
  Can two webhook events for the same MR race?
- **Idempotency**: Can the same event be safely processed twice? Does the plan address
  duplicate webhook delivery, retry storms, or at-least-once delivery semantics?
- **Resource exhaustion**: Does the plan bound memory usage, subprocess count, disk
  consumption, or open connections? Can a malicious or malformed MR with thousands of
  files exhaust system resources?
- **Rollback strategy**: If a phase is deployed and fails in production, how is the
  change rolled back? Is the feature flag-gated? Can the previous behavior be restored
  without code changes?
- **Graceful degradation**: When the plan introduces a new capability that depends on
  an external service (Jira, LLM, GitLab), does the system degrade gracefully when
  that service is unavailable, or does it hard-fail the entire pipeline?

### Step 5 — Plan Structure & Completeness Review

Evaluate the plan as a document — is it implementable as written?

**Required checks:**

- **Phase ordering**: Are phases ordered by dependency? Can any phase be started before
  its prerequisites are complete? Are circular dependencies between phases present?
- **Task granularity**: Are tasks concrete enough for an implementing agent to execute
  without guessing? Do tasks specify which files to create or modify, and what behavior
  to implement? Flag hand-wavy tasks like "implement the feature" or "add tests."
- **Documentation per phase**: Does every phase include a documentation overhaul step?
  Flag any phase that changes behavior, configuration, or architecture without updating
  corresponding docs.
- **Test coverage per phase**: Does every phase include a test step? If tests are
  deferred, is the deferral explicitly justified and the covering phase named? Flag
  phases with no testing obligation and no justification.
- **Scope creep**: Does the plan include work that is not required by the stated goal?
  Is the plan solving adjacent problems that should be separate plans?
- **Conflict with active plans**: Does the plan modify files or systems that are claimed
  by an active plan? Are coordination strategies documented?
- **AGENTS.md compliance**: Does the plan respect all critical rules from AGENTS.md?
  Bun-only, Zod validation, Biome formatting, internal protocol boundary, security
  sandboxing, plan/docs update requirements.

### Step 6 — Classify and Report

Categorize every finding using **exactly** these severity levels:

| Severity | Definition | Implementation Gate |
|---|---|---|
| `BLOCKER` | The plan cannot be implemented safely or correctly as written. Architectural flaw, security vulnerability, or missing critical design. | Implementation **must not start** until resolved. |
| `RISK` | The plan will likely cause problems during implementation or in production. Missing edge case handling, questionable dependency, weak resilience strategy. | Implementation **should not start** until addressed, but may proceed with documented acceptance. |
| `OPTIMIZATION` | The plan works but can be improved. Better library choice, cleaner phase structure, tighter scope. | Implementation may proceed; address during or after implementation. |

**Every finding must include:**

1. **Severity**: `BLOCKER` | `RISK` | `OPTIMIZATION`
2. **Dimension**: Which review dimension it falls under (Architecture, Library, Security, Resilience, Structure)
3. **Finding**: What is wrong — specific, evidence-based, no vague concerns
4. **Impact**: What happens if this is not addressed
5. **Alternative**: A concrete actionable fix — not "consider improving" but "replace X with Y because Z"

## Report Format

```markdown
## Plan Review: [Plan Title]

**Plan file**: `docs/plans/...`
**Reviewed against**: AGENTS.md, docs/context/*, active plans
**Verdict**: 🔴 NOT READY / 🟡 CONDITIONAL / 🟢 READY

### Summary

[2-3 sentence executive summary of the plan's readiness]

**Findings**: X BLOCKER · Y RISK · Z OPTIMIZATION

---

### BLOCKERs

#### B1: [Short title]
- **Dimension**: [Architecture | Library | Security | Resilience | Structure]
- **Finding**: [What is wrong]
- **Impact**: [What happens if not addressed]
- **Alternative**: [Concrete fix]

---

### RISKs

#### R1: [Short title]
...

---

### OPTIMIZATIONs

#### O1: [Short title]
...

---

### Confirmed Strengths

[Call out aspects of the plan that are well-designed, well-scoped, or particularly thorough]

### Verdict Details

[Explain the verdict. If CONDITIONAL, state exactly which findings must be resolved
before implementation can proceed. If NOT READY, state the minimum changes required.]
```

## Decision Rules

- Prioritize findings that create architectural bottlenecks, security vulnerabilities, or
  dependency bloat over subjective style or naming preferences.
- Do not raise findings about code style, naming conventions, or formatting — those are
  Biome's job.
- If the plan's architecture is fundamentally sound but has gaps, mark it `CONDITIONAL`,
  not `NOT READY`.
- If the plan has zero BLOCKERs and zero RISKs, mark it `READY`.
- If the plan has BLOCKERs, mark it `NOT READY` regardless of everything else.
- If the plan has RISKs but no BLOCKERs, mark it `CONDITIONAL`.
- Every critique must have an actionable alternative. "This is bad" without "do this
  instead" is not a valid finding.
- Do not invent hypothetical problems. Ground every finding in the plan text, the current
  codebase, or documented constraints from AGENTS.md.

## Completion Checks

Before delivering the report:
- Every review dimension (Architecture, Library, Security, Resilience, Structure) was
  explicitly evaluated — none skipped
- Every finding has a severity, dimension, finding description, impact, and alternative
- The finding counts in the summary match the actual findings listed
- The verdict matches the severity distribution (BLOCKERs → NOT READY, RISKs → CONDITIONAL)
- Confirmed strengths are called out — the report is not only negative
- No finding lacks an actionable alternative
- The plan file path and review context are stated at the top

## Preferred Prompts

- Review this implementation plan for architectural, security, and dependency risks before we start building.
- Audit `docs/plans/backlog/...` as a principal engineer — find the blockers and risks.
- Is this plan ready for implementation? Classify every concern as BLOCKER, RISK, or OPTIMIZATION.
- Review the plan I just created and tell me what needs to change before we write code.
- Stress-test this plan's resilience and security posture.

## Plan Review: GitGandalf — Master Implementation Plan

**Plan file**: `docs/plans/active/git-gandalf-master-plan.md`
**Reviewed against**: AGENTS.md, docs/context/*, active plans
**Verdict**: 🔴 NOT READY

### Summary

The master plan is directionally strong on the core Bun, Hono, Zod, GitLab, and internal-agent-contract choices, and it remains a reasonable top-level roadmap for the system. However, the two next planned phases are not ready as written: Phase 4.5 leaves critical Jira boundary decisions implicit, and Phase 4.6 is framed around a GitLab SaaS vs self-hosted split that is not supported by the current implementation reality.

**Findings**: 2 BLOCKER · 5 RISK · 2 OPTIMIZATION

---

### BLOCKERs

#### B1: Phase 4.6 defines the wrong abstraction for GitLab compatibility
- **Dimension**: Architecture
- **Finding**: Phase 4.6 proposes adding `GITLAB_SELF_HOSTED=true` and using it to drive compatibility behavior. The current code already supports self-hosted GitLab by URL-driven configuration through `src/config.ts`, API instantiation through `src/gitlab-client/client.ts`, and clone-host validation through `src/context/repo-manager.ts`. The plan does not identify a concrete runtime incompatibility that a boolean flag would solve. It does not model the real compatibility surface: custom CA handling, TLS verification controls, instance base-path behavior, clone authentication mode, or supported token types.
- **Impact**: Implementation can add dead configuration and misleading branching without fixing any real deployment issue. It also risks institutionalizing a false mental model that “GitLab.com vs self-hosted” is the important boundary when the real issues are transport, auth, and deployment-shape specifics.
- **Alternative**: Replace Phase 4.6 with a concrete “GitLab Deployment Hardening” phase. Focus the tasks on verified integration seams only: custom CA / TLS settings, clone auth mode, reverse-proxy or subpath compatibility if applicable, supported token combinations, and a documented test matrix for GitLab.com vs the already-working self-hosted deployment.

#### B2: Phase 4.5 does not define a safe Jira read-only contract
- **Dimension**: Security
- **Finding**: Phase 4.5 introduces Jira enrichment but does not explicitly lock the phase to read-only behavior. It also promises `acceptanceCriteria when present` without defining how custom fields are mapped, whether Jira Cloud only or Jira Cloud + Data Center is in scope, or which actions are explicitly prohibited. The user requirement is clear: Jira must remain read-only, and any write behavior must be deferred.
- **Impact**: An implementer would have to guess the Jira contract and could accidentally introduce a broader client surface than intended, including potential write capabilities or deployment-specific field assumptions. That is unacceptable at the plan stage because Jira integrations often grow hidden scope and credential risk.
- **Alternative**: Rewrite Phase 4.5 as “Jira Read-Only Context Enrichment” with explicit non-goals: no issue comments, no transitions, no worklogs, no field edits, no issue creation, and no link mutation. Move any future Jira write capabilities into a new Phase 6, explicitly named and deferred.

---

### RISKs

#### R1: The BullMQ + iovalkey pairing is not justified by the documented integration surface
- **Dimension**: Library
- **Finding**: The plan says “BullMQ (MIT) + Valkey” and specifically “Use `iovalkey`.” Live BullMQ documentation describes BullMQ as using `ioredis` and its connection guidance assumes `ioredis` instances and options. The plan does not provide evidence that `iovalkey` is a supported BullMQ client path.
- **Impact**: Phase 5 may hit avoidable implementation friction or a late redesign after the queue architecture is already committed.
- **Alternative**: Either change the queue phase to BullMQ + Valkey server + documented `ioredis`, or add a required compatibility spike before Phase 5 that proves BullMQ works correctly with `iovalkey` before naming it as the selected client.

#### R2: Jira enrichment lacks operational bounds in the synchronous review path
- **Dimension**: Resilience
- **Finding**: Phase 4.5 does not define a timeout budget, maximum number of linked ticket keys per MR, selected field projection, retry policy, or deduplication within a single run. Current workflow docs show the review pipeline remains request-triggered and latency-sensitive.
- **Impact**: Slow or failing Jira requests can materially delay reviews or make the pipeline appear flaky. An MR containing many ticket keys can inflate external-call cost beyond what is acceptable for the current architecture.
- **Alternative**: Add explicit bounds to the plan: cap ticket fetches per run, fetch only required fields, apply a short timeout, do not retry within the request path unless the retry is bounded and cheap, dedupe repeated keys, and always log-and-continue on Jira failure.

#### R3: The plan assumes “acceptance criteria” is a standard Jira field
- **Dimension**: Structure
- **Finding**: Phase 4.5 says the normalized Jira ticket shape includes `acceptanceCriteria when present`, but Jira acceptance criteria is commonly a custom field or encoded in description conventions. The plan does not specify whether this is configured by field ID, parsed from description, or omitted when not explicitly mapped.
- **Impact**: Implementers must guess field semantics per deployment, which invites brittle code and unclear documentation.
- **Alternative**: Narrow the v1 normalized shape to standard fields only unless a custom-field mapping is configured. If acceptance criteria is needed, add an explicit config key such as `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID` and document that it is optional and deployment-specific.

#### R4: The master plan is not coordinated with the active edge-case hardening plan
- **Dimension**: Structure
- **Finding**: `docs/plans/implemented/review-edge-cases-hardening.md` owned many of the same files that Phase 4.5 and 4.6 would modify, including `src/api/router.ts`, `src/api/pipeline.ts`, `src/api/schemas.ts`, `src/gitlab-client/client.ts`, and `src/agents/state.ts`. The master plan did not mention this overlap or define an ordering constraint.
- **Impact**: Future implementation can easily create contradictory designs or duplicated changes in trigger context, pipeline sequencing, and GitLab client behavior.
- **Alternative**: Add an explicit dependency note that Phase 4.5 and any GitLab deployment hardening work must build on the trigger/checkpoint/range-selection work from the active edge-case hardening plan rather than proceeding independently.

#### R5: The verification plan is missing a mandatory dependency-audit gate
- **Dimension**: Security
- **Finding**: The plan’s verification section does not require `bun audit`. Running `bun audit` on the current repo reports 2 vulnerabilities through `@aws-sdk/client-bedrock-runtime` transitively via `fast-xml-parser`: 1 high and 1 moderate.
- **Impact**: Future phases can add dependencies or expand attack surface without a formal vulnerability review step in the plan.
- **Alternative**: Add `bun audit` to the verification plan and require explicit disposition of findings before merging dependency-affecting phases.

---

### OPTIMIZATIONs

#### O1: Use direct fetch for Jira instead of adopting a Jira SDK
- **Dimension**: Library
- **Finding**: The plan says “Thin typed client for Jira issue lookup by key,” which is good, but it does not explicitly forbid adding a Jira SDK. Available evidence suggests common Jira Node clients such as `jira-node/node-jira-client` are stale relative to the current stack and add unnecessary abstraction for a narrow read-only use case.
- **Impact**: An implementer may introduce extra dependency weight, outdated abstractions, and a broader surface area than the plan actually needs.
- **Alternative**: State explicitly in Phase 4.5 that Jira integration should use direct `fetch` plus a small in-repo typed wrapper. Do not add an external Jira SDK for read-only issue lookup.

#### O2: Rename Phase 4.6 so the title reflects the real problem
- **Dimension**: Structure
- **Finding**: “GitLab SaaS + Self-Hosted Compatibility” biases the implementation toward a platform toggle rather than investigating concrete deployment differences.
- **Impact**: The title itself encourages shallow config branching instead of hardening real auth, transport, and deployment seams.
- **Alternative**: Rename the phase to “GitLab Deployment Hardening” or “GitLab Transport and Auth Hardening.”

---

### Confirmed Strengths

- The core platform choices remain sound and aligned with AGENTS.md: Bun runtime, Hono, Zod at boundaries, Biome, and an internal provider-agnostic agent protocol.
- The plan correctly keeps the internal LLM contract as the architectural boundary rather than letting provider SDK types leak into the app model.
- The Jira direction is product-relevant and appropriately framed as enrichment rather than a hard dependency for the review pipeline.
- The current codebase already demonstrates that self-hosted GitLab is a working deployment target, which is useful evidence for narrowing the scope of the next GitLab phase.
- The plan’s phased structure is generally understandable and the completed phases map to real repo surfaces, even if some historical text now needs refreshing.

### Verdict Details

The plan is **NOT READY** because the next two intended phases are not precise enough to implement safely. Minimum required changes before implementation starts:

1. Rewrite Phase 4.5 as an explicitly **read-only Jira enrichment** phase with bounded scope, explicit non-goals, and a deployment-safe field model.
2. Add a new **Phase 6** placeholder for any future Jira write-mode features.
3. Replace or substantially rewrite Phase 4.6 so it targets real GitLab deployment hardening concerns rather than a generic `GITLAB_SELF_HOSTED` flag.
4. Add coordination notes with the active edge-case hardening plan.
5. Add `bun audit` to the verification plan.

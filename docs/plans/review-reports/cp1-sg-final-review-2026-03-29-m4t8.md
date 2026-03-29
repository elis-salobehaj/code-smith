## Plan Review: CP1-SG — Repo Config Security Gate Final Audit

**Plan file**: `docs/plans/implemented/repo-config-security-gate-plan.md`
**Reviewed against**: AGENTS.md, docs/context/*, active plans
**Verdict**: 🟢 READY

### Summary

The CP1-SG implementation is structurally complete and the shipped trusted-baseline model is sound. This review pass identified three agent-fixable risks, then remediated and re-verified them in the same pass: the stale shipped-state wording is gone, the deterministic suppression heuristic now catches broad root-level source-tree wildcards, and the deterministic suite now directly covers unsafe rule patterns plus marker and payload abuse.

**Findings**: 0 BLOCKER · 3 RISK · 0 OPTIMIZATION

---

### BLOCKERs

None.

---

### RISKs

#### R1: stale shipped-state wording remains in docs and env guidance
- **Dimension**: Docs
- **Finding**: `.env.example` still describes the SG3 LLM gate as "planned", and `docs/designs/repo-config-security-gate.md` still ends with a "Recommended Next Step" instructing readers to implement SG1 first even though CP1-SG is already implemented.
- **Impact**: Operators and future contributors can misread the current deployment state and implementation status, which undermines the plan closeout and makes later reviews noisier.
- **Alternative**: Update `.env.example` and `docs/designs/repo-config-security-gate.md` so both describe the shipped state and point readers at the implemented plan and review artifacts.

#### R2: deterministic scope-suppression logic misses broad source-tree wildcard patterns
- **Dimension**: Security
- **Finding**: `src/config/repo-config-security.ts` only treats scope-shaping patterns as suppressive when they are total catch-alls or contain no literal segments. Broad root-level subtree wildcards such as `src/**` or `app/**` can still evade deterministic quarantine even though they would suppress large, security-relevant portions of a repository if trusted later.
- **Impact**: Candidate repo config can still carry high-blast-radius exclusion or file-rule patterns into post-merge policy without a deterministic finding, weakening the explicit SG1 safety boundary.
- **Alternative**: Extend the deterministic suppression heuristic to flag broad root-level source-tree wildcard patterns while preserving common generated/build directory exclusions.

#### R3: critical deterministic detectors lack direct regression coverage
- **Dimension**: Tests
- **Finding**: The deterministic suite does not directly assert quarantine behavior for unsafe `file_rules[].pattern` entries, markdown-marker abuse, or encoded-payload abuse even though those categories are documented and implemented in `src/config/repo-config-security.ts`.
- **Impact**: Future edits can silently weaken high-risk detector categories without breaking CI, especially in the exact path meant to remain authoritative over the no-tool LLM pass.
- **Alternative**: Add focused unit tests in `tests/repo-config.test.ts` and a loader-level regression proving unsafe rule patterns are removed before config reaches downstream consumers.

---

### OPTIMIZATIONs

None.

---

### Ordered Remediation Steps

- [x] **[agent] Align stale shipped-state docs**: Updated `.env.example` and `docs/designs/repo-config-security-gate.md` to reflect the implemented CP1-SG state rather than pre-implementation guidance.
- [x] **[agent] Tighten deterministic scope-suppression detection**: Extended `src/config/repo-config-security.ts` to quarantine broad root-level source-tree wildcard patterns without regressing scoped rules or common generated/build exclusions.
- [x] **[agent] Add focused deterministic regressions**: Expanded `tests/repo-config.test.ts` to cover unsafe `file_rules[].pattern`, markdown-marker abuse, encoded payload abuse, and the new broad-root suppression heuristic, then re-verified the focused suites.

### Required Validations

- [x] `bun run check`
- [x] `bun run ci`
- [x] Documentation references verified after remediation
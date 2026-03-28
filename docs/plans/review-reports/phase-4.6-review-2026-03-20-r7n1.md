## Plan Review: GitGandalf Master Plan — Phase 4.6 (GitLab Deployment Hardening)

**Plan file**: `docs/plans/active/git-gandalf-master-plan.md`
**Reviewed against**: AGENTS.md, docs/context/ARCHITECTURE.md, docs/context/WORKFLOWS.md, docs/context/CONFIGURATION.md
**Verdict**: 🟢 READY — 0 BLOCKERs · 0 RISKs · 1 OPTIMIZATION

---

### Summary

Phase 4.6 is fully implemented, tested, documented, and correctly scoped.
All three plan items are met with real code, not scaffolding: `GITLAB_CA_FILE` is Zod-validated,
`buildGitEnv()` wires `GIT_SSL_CAINFO` into every git subprocess, `NODE_EXTRA_CA_CERTS` is set
at startup before any TLS connections open, and the supporting documentation covers the full
deployment matrix including GitLab.com, self-hosted with a public cert, and self-hosted with
an internal CA. No deployment-mode flag was added — consistent with the plan's explicit constraint.

**Findings**: 0 BLOCKER · 0 RISK · 1 OPTIMIZATION

---

### OPTIMIZATIONs

#### O1: GITLAB_CA_FILE could log a warning when the file is set but does not exist at startup

- **Dimension**: Resilience
- **Finding**: `src/index.ts` sets `process.env.NODE_EXTRA_CA_CERTS = config.GITLAB_CA_FILE` without checking
  whether the file actually exists on disk. If the path is misconfigured (e.g. mounted volume not ready yet),
  the first TLS connection will fail with a cryptic `unable to get local issuer certificate` rather than a
  clear startup message. Similarly, `buildGitEnv()` propagates the path to git without a file-existence check.
- **Impact**: Misconfigured `GITLAB_CA_FILE` produces silent or cryptic failures at TLS time rather than a
  clear startup diagnostic. Cosmetic for correct configurations; annoying to debug when wrong.
- **Alternative**: In `src/index.ts`, after setting `NODE_EXTRA_CA_CERTS`, add an async `stat(config.GITLAB_CA_FILE)`
  check and `logger.warn(...)` if the file does not exist. Deferring until the logger is initialized is fine.
  This is purely defensive — the core functionality is complete without it.

---

### Confirmed Strengths

- **`GITLAB_SELF_HOSTED` flag deliberately omitted**: implementation is consistent with plan guidance; no
  spurious boolean flag was added.
- **`buildGitEnv()` is a pure exported function**: transparent to tests without needing to mock Bun.spawn
  or manipulate the config singleton. Five unit tests cover all meaningful branches including the empty-string
  falsy edge case.
- **`run()` env construction**: `env: { ...process.env, ...extraEnv }` correctly preserves the full process
  env (so git can find its own executables and use existing env vars) while adding `GIT_SSL_CAINFO` on top.
  This is the correct Bun.spawn pattern — without spreading `process.env`, git subprocesses would inherit
  no environment at all.
- **SSRF guard unchanged**: the existing hostname comparison is intentionally correct for the threat model
  (prevent token exfiltration to a different domain). No hostname/host confusion regression.
- **Startup ordering**: `process.env.NODE_EXTRA_CA_CERTS` is set before `initLogging()` and before any
  HTTPS connections — the only safe ordering for a TLS CA cert to take effect in Bun.
- **Docs deployment matrix**: the new GETTING_STARTED.md section covers all three realistic deployment
  variants (GitLab.com, self-hosted trusted cert, self-hosted internal CA), explains token mechanics,
  subpath handling, and gives a concrete Docker mounting example.
- **All AGENTS.md conventions met**: Bun-only commands, Zod validation at config boundary, Biome clean,
  plan checkboxes updated, `docs/README.md` updated, no security regressions.

---

### Verdict & Remediation Details

Phase 4.6 meets the plan's full obligations. The single OPTIMIZATION (startup file-existence check) is
purely defensive and does not affect correctness or security. No remediation is required before completion.

No `[human]` decisions are needed. Marking phase complete.

---

### Ordered Remediation Steps

_No blockers or risks — no remediation required._

Optional follow-up (can be deferred):
- [ ] **[agent] O1 — Add startup file-existence warn for GITLAB_CA_FILE**: after `await initLogging()`
  in `src/index.ts`, check `await stat(config.GITLAB_CA_FILE)` and emit a `logger.warn` if the file does
  not exist. Completion criterion: clear warning logged at startup when `GITLAB_CA_FILE` points at a
  missing file.

---

### Required Validations

- [x] `bun run check` — no fixes applied (42 files clean)
- [x] `bun run typecheck` — clean
- [x] `bun test` — 198 pass, 0 fail
- [x] Documentation references verified — CONFIGURATION.md, ARCHITECTURE.md, WORKFLOWS.md,
      GETTING_STARTED.md, docs/README.md, and master plan all updated and consistent

---
title: "Deno Runtime Evaluation And Migration Plan"
status: backlog
priority: medium
estimated_hours: 60-100
dependencies:
  - docs/plans/active/git-gandalf-master-plan.md
created: 2026-03-17
date_updated: 2026-03-17

related_files:
  - package.json
  - tsconfig.json
  - Dockerfile
  - docker-compose.yml
  - src/index.ts
  - src/config.ts
  - src/logger.ts
  - src/api/router.ts
  - src/api/pipeline.ts
  - src/context/repo-manager.ts
  - src/context/tools/read-file.ts
  - src/context/tools/search-codebase.ts
  - src/agents/llm-client.ts
  - src/agents/prompt-loader.ts
  - tests/webhook.test.ts
  - tests/tools.test.ts
  - tests/agents.test.ts
  - tests/publisher.test.ts
  - docs/agents/context/ARCHITECTURE.md
  - docs/agents/context/CONFIGURATION.md
  - docs/agents/context/WORKFLOWS.md
  - docs/humans/context/ARCHITECTURE.md
  - docs/humans/designs/multi-agent-architecture.md
  - docs/humans/designs/tech-stack-evaluation.md
tags:
  - deno
  - runtime-migration
  - security
  - architecture
  - operations
completion:
  - "# Phase D0 — Decision Gate"
  - [ ] D0.1 Confirm migration goal is runtime hardening, not edge hosting or frontend expansion
  - [ ] D0.2 Approve a spike-first strategy instead of immediate full migration
  - [ ] D0.3 Define success criteria for security, compatibility, performance, and operator ergonomics
  - "# Phase D1 — Feasibility Spike"
  - [ ] D1.1 Prove Hono + Bedrock + GitLab + LogTape run under Deno in a thin vertical slice
  - [ ] D1.2 Replace Bun-only APIs in the spike path and document exact permission flags
  - [ ] D1.3 Verify npm compatibility for `@aws-sdk/client-bedrock-runtime` and `@gitbeaker/rest`
  - [ ] D1.4 Validate git and ripgrep subprocess execution through `Deno.Command`
  - [ ] D1.5 Measure cold start, request latency, and review throughput against Bun baseline
  - "# Phase D2 — Tooling And Runtime Foundation"
  - [ ] D2.1 Introduce `deno.json` tasks, fmt, lint, lockfile, and import strategy
  - [ ] D2.2 Replace Bun runtime APIs with Deno or standards-based equivalents
  - [ ] D2.3 Rework env loading, YAML parsing, and UUID generation for Deno
  - [ ] D2.4 Update Docker image, local dev instructions, and CI command surface
  - "# Phase D3 — Application Migration"
  - [ ] D3.1 Port server bootstrap, router, pipeline, and logger runtime assumptions
  - [ ] D3.2 Port repo manager and context tools to `Deno.Command` and Deno file APIs
  - [ ] D3.3 Validate Bedrock adapter behavior and GitLab publishing behavior under Deno
  - [ ] D3.4 Preserve internal protocol and Zod boundaries unchanged where possible
  - "# Phase D4 — Test And Quality Migration"
  - [ ] D4.1 Replace `bun:test` suites with `Deno.test` plus compatible mocks/spies
  - [ ] D4.2 Restore full coverage for webhook, repo, tool, agent, publisher, and logger behavior
  - [ ] D4.3 Add permission-aware integration tests for git, ripgrep, prompt loading, and logging
  - "# Phase D5 — Rollout And Hardening"
  - [ ] D5.1 Run dual-runtime comparison in a non-production environment
  - [ ] D5.2 Review Deno permission scope against actual operational needs
  - [ ] D5.3 Update all docs and active plans if Bun is retired
  - [ ] D5.4 Run plan-phase audit before marking migration complete
---

# Deno Runtime Evaluation And Migration Plan

## Executive Summary

This plan evaluates whether GitGandalf should move from Bun to Deno.

The core attraction is real: Deno offers a much stronger default security posture
than Bun because filesystem, environment, network, and subprocess access are
permission-gated rather than implicitly allowed. For a service that receives
webhooks, clones repositories, reads arbitrary code within a sandbox, calls LLM
providers, and posts data back to GitLab, that is a meaningful platform-level
control.

At the same time, GitGandalf is currently a Bun-first backend with several
intentional Bun-native choices:

- Bun runtime bootstrap in `src/index.ts`
- Bun environment assumptions in `src/logger.ts`
- Bun UUID generation in `src/api/router.ts` and `src/agents/llm-client.ts`
- Bun subprocess management in `src/context/repo-manager.ts` and `src/context/tools/search-codebase.ts`
- Bun file APIs in `src/context/tools/read-file.ts`
- Bun YAML parsing in `src/agents/prompt-loader.ts`
- Bun test runner usage across the full test suite
- Bun-centric scripts, Docker image, docs, and developer workflow

That means a Deno move is not a drop-in runtime swap. It is a controlled runtime,
tooling, test, and operations migration.

## Recommendation

Do not approve a full Bun-to-Deno migration immediately.

Approve a bounded feasibility spike first.

That recommendation is based on four facts about the current system:

1. GitGandalf's architecture is portable in some important places.
   Hono, Zod, the internal agent protocol, and the thin wrapper boundaries around
   Bedrock and GitLab are all good foundations for runtime portability.

2. GitGandalf's implementation is still materially Bun-specific.
   The repo manager, search tool, prompt loader, server bootstrap, logger setup,
   tests, and operator workflow all assume Bun today.

3. Deno's security value is meaningful but not free.
   This service needs network access, environment access, file read/write access,
   and subprocess execution. Deno can scope those permissions, but the final
   permission set will still be broad enough that the security gain is reduced
   unless the scope is kept tight and verified continuously.

4. The highest migration risk is not Hono or TypeScript.
   The highest risk is the combination of npm compatibility, subprocess-heavy repo
   tooling, AWS Bedrock auth behavior, and full test-suite migration away from
   `bun:test`.

Decision guidance:

- If the top goal is platform-enforced least privilege for self-hosted backend
  execution, Deno is worth a serious spike.
- If the top goal is raw implementation speed, lowest migration cost, and keeping
  the current repo stable while Phase 4.5/4.6/5 work proceeds, Bun remains the
  lower-risk choice.
- If the team wants the security benefits, the right path is: spike first,
  compare objectively, then decide.

## Why Deno Is Attractive For GitGandalf

### 1. Permission-based security model

Deno starts with no ambient access and requires explicit permissions.

For GitGandalf, the relevant controls are:

- `--allow-net` for GitLab API, Bedrock API, inbound HTTP listen, and optionally
  Jira in future phases
- `--allow-env` for GitLab, AWS, logging, cache, and port configuration
- `--allow-read` for prompt files, local config files, cached repos, and log paths
- `--allow-write` for repo cache and log output
- `--allow-run=git,rg` for repository clone/fetch/reset and code search

This is materially better than Bun's default trust model because the runtime can
refuse access outside the declared envelope.

### 2. Better alignment with “sandbox the reviewer” goals

GitGandalf is a code-review system that:

- clones external repositories
- reads source trees
- shells out to developer tools
- handles secrets for GitLab and Bedrock

Deno's permission model aligns conceptually with the product's own security story.
It gives operators a platform-level way to say, “this process may read only these
paths, write only these paths, call only these hosts, and execute only these binaries.”

### 3. Strong built-in platform surface

Deno provides first-class built-ins for:

- tasks via `deno task`
- formatting via `deno fmt`
- linting via `deno lint`
- testing via `deno test`
- lockfile and dependency management via `deno add` and `deno.lock`
- environment file loading via `--env-file`
- subprocess execution via `Deno.Command`
- file APIs via `Deno.readTextFile`, `Deno.writeTextFile`, and related methods

That reduces the number of external workflow tools needed if the repo chooses to
embrace Deno fully rather than only using it as a JS runtime.

## Why Deno Is Not An Automatic Win

### 1. GitGandalf needs broad permissions in practice

This is not a read-only HTTP JSON service.

GitGandalf needs to:

- listen on a port
- call GitLab over the network
- call AWS Bedrock over the network
- read environment variables
- read prompt YAML and source-adjacent assets
- write logs
- clone and update repos on disk
- execute `git`
- execute `rg`

So while Deno improves the default posture, the real runtime envelope will still
be substantial.

The security gain is still real, but it is not equivalent to “Deno makes the app
safe by default.” The permission set must be designed carefully, enforced in
deployment, and kept narrow over time.

### 2. The repo is operationally Bun-native today

The current docs, scripts, tests, container image, and development guide all
assume Bun.

Moving to Deno affects:

- developer onboarding
- CI commands
- Docker base image and runtime command
- test and mocking idioms
- local `.env` loading behavior
- plan docs and technical decision records

This is an operations and workflow migration, not just a runtime migration.

### 3. Deno Deploy is not the target runtime

GitGandalf shells out to `git` and `rg`, uses a writable repo cache, and expects
full local filesystem access within controlled paths.

That means the relevant target is self-hosted Deno runtime in Docker or VMs,
not Deno Deploy. The move does not buy “edge-native deployment” for this app.

## Current Architecture Traits That Help A Deno Move

GitGandalf is better-positioned for a runtime migration than many backend repos.

### Architecture strengths

- Hono is runtime-portable and already supports Deno well.
- The app owns its internal agent protocol in `src/agents/protocol.ts`.
- Bedrock is isolated behind `src/agents/llm-client.ts`.
- GitLab access is isolated behind `src/gitlab-client/client.ts`.
- Tool definitions are internal and modular under `src/context/tools/`.
- Zod already protects the external boundaries.

Those boundaries limit how much business logic would need to change.

### Architecture constraints

- Runtime bootstrap is Bun-shaped.
- Repo access is Bun-shaped.
- Search execution is Bun-shaped.
- Prompt loading is Bun-shaped.
- Logging setup assumes Bun env behavior.
- The entire test suite is Bun-shaped.

So GitGandalf is architecturally portable, but implementation-portability is only partial.

## Bun-To-Deno Compatibility Matrix

| Area | Current Choice | Deno Fit | Migration Notes |
|---|---|---|---|
| Runtime | Bun | Replace | Requires `deno.json`, lockfile, tasks, container, and local workflow changes |
| HTTP framework | Hono | Keep | Hono is a strong fit on Deno; low risk |
| Validation | Zod | Keep | Low risk; works fine under Deno |
| Bedrock SDK | `@aws-sdk/client-bedrock-runtime` | Likely keep, verify in spike | npm compatibility should work, but bearer-token auth path must be proven |
| GitLab client | `@gitbeaker/rest` | Maybe keep, verify in spike | Medium risk; if npm compatibility is rough, replace with direct `fetch` wrapper |
| Logging library | LogTape | Probably keep, verify in spike | Low-to-medium risk; current file sink and context wiring need runtime validation |
| Repo subprocesses | `Bun.spawn()` | Rewrite | Replace with `Deno.Command` |
| File access | `Bun.file()` | Rewrite | Replace with Deno file APIs |
| YAML parsing | `Bun.YAML.parse()` | Rewrite | Replace with `@std/yaml` |
| UUID v7 | `Bun.randomUUIDv7()` | Rewrite | Use `uuid` v7 or downgrade to `crypto.randomUUID()` where ordering is not needed |
| Env loading | Bun automatic `.env` loading | Rewrite | Use `deno run --env-file` or std dotenv strategy |
| Testing | `bun:test` | Rewrite | Replace with `Deno.test` and new mocking strategy |
| Package management | `bun install` | Replace | Move to `deno add`, JSR/npm imports, and `deno.lock` |
| Formatting/linting | Biome | Choice | Can keep Biome or move to `deno fmt`/`deno lint`; keep Biome if rules and consistency matter |

## Exact Rewrite Scope By File Or Subsystem

### 1. Project tooling and metadata

#### `package.json`

Current role:

- dependency manifest
- Bun scripts for dev, start, test, typecheck, lint, format, and CI

Required rewrite:

- add `deno.json`
- decide whether `package.json` remains only for npm compatibility metadata or is removed
- replace `bun run --hot`, `bun test`, and Bun-centric scripts with `deno task` commands
- adopt `deno.lock`

Recommended Deno replacement:

- `deno.json` with `tasks`, `imports`, `fmt`, `lint`, and lockfile enabled

#### `tsconfig.json`

Current role:

- TypeScript compiler settings
- Bun-specific type surface via `types: ["bun-types"]`

Required rewrite:

- remove Bun types
- move runtime-relevant compiler settings into `deno.json`
- decide whether `tsconfig.json` remains only for editor/tooling support

Recommended Deno replacement:

- Deno-first compiler config in `deno.json`

### 2. Server bootstrap and environment loading

#### `src/index.ts`

Current role:

- initialize logging
- build Hono app
- export Bun server config `{ port, fetch }`

Why this breaks on Deno:

- the Bun export-based server bootstrap is Bun-specific

Required rewrite:

- switch to `Deno.serve({ port: config.PORT }, app.fetch)` or equivalent main-entry bootstrap

Recommended Deno replacement:

- keep Hono
- change only the runtime bootstrap strategy

#### `src/config.ts`

Current role:

- parse env with Zod from `process.env`

Migration impact:

- likely minor
- `process.env` may still work in compatibility mode, but that is not the best Deno-native path

Recommended Deno replacement:

- prefer `Deno.env.toObject()` or explicit `Deno.env.get()` collection behind the same Zod schema
- use `--env-file=.env` for local dev and container startup

### 3. Logging and observability

#### `src/logger.ts`

Current role:

- LogTape configuration
- console + debug file sinks
- request-context propagation via `AsyncLocalStorage`
- Bun env check for tests

Why it needs work:

- uses `Bun.env.NODE_ENV`
- uses Node-specific file and stream modules
- relies on current runtime behavior for sink wiring

Migration impact:

- medium, not catastrophic
- most logger semantics can likely stay

Best option:

- first choice: keep LogTape if Deno npm compatibility behaves correctly
- fallback: replace with a Deno-friendly structured logger only if LogTape proves unstable

Possible fallback replacements:

- `jsr:@std/log` if a simpler Deno-native logger is acceptable
- `npm:pino` only if Deno-native options are insufficient

Recommendation:

- try to preserve LogTape because its current category model and Hono integration
  are already good fits for the repo

### 4. Router and ID generation

#### `src/api/router.ts`

Current role:

- webhook secret validation
- Zod payload validation
- event filtering
- request ID generation via `Bun.randomUUIDv7()`

Required rewrite:

- replace Bun UUID generation

Best replacement:

- `crypto.randomUUID()` if sortable UUID semantics are not required
- `npm:uuid` with v7 generation if ordering is desired operationally

Recommendation:

- use `crypto.randomUUID()` unless the team has a real downstream need for v7 ordering

### 5. Repo cache manager and subprocess layer

#### `src/context/repo-manager.ts`

Current role:

- shallow clone and refresh through `Bun.spawn()`
- cache cleanup
- host validation to prevent token exfiltration

Why it matters:

- this is one of the most runtime-sensitive modules in the whole app
- it is central to security and performance

Required rewrite:

- replace `Bun.spawn()` with `Deno.Command`
- verify stdout/stderr handling, exit-code checks, and timeout behavior
- design explicit `--allow-run=git` permission policy

Best Deno replacement:

- `new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })`

Important note:

- Deno improves the subprocess permission model here materially because the app can
  be denied execution of anything except `git` and `rg`

### 6. Context tools

#### `src/context/tools/read-file.ts`

Current role:

- sandboxed repo-relative file reads via `Bun.file().text()`

Required rewrite:

- replace with `Deno.readTextFile()`

Risk:

- low

#### `src/context/tools/search-codebase.ts`

Current role:

- spawns `rg --json` and parses results

Required rewrite:

- replace `Bun.spawn()` with `Deno.Command`
- verify `rg` stderr/stdout parsing behavior
- design `--allow-run=rg` permission scope

Risk:

- medium because this is high-frequency, tool-loop code

#### `src/context/tools/get-directory-structure.ts`

Current role:

- uses Node filesystem APIs that Deno usually supports under Node compatibility

Migration approach:

- either keep Node compatibility imports if they are stable in the spike
- or rewrite to Deno-native directory traversal for stricter portability

Recommendation:

- prefer Deno-native filesystem APIs over long-term dependence on Node compatibility
  in core repo-walking code

### 7. Agent prompt loading and YAML parsing

#### `src/agents/prompt-loader.ts`

Current role:

- loads YAML prompt config from disk
- parses YAML with `Bun.YAML.parse()`

Why it needs rewrite:

- `Bun.YAML.parse()` is Bun-specific

Best Deno replacement:

- `jsr:@std/yaml` parser

Risk:

- low

### 8. Bedrock client adapter

#### `src/agents/llm-client.ts`

Current role:

- official AWS Bedrock Runtime adapter
- converts internal protocol to Converse request/response
- uses `Bun.randomUUIDv7()` as fallback tool call ID

Migration impact:

- small code rewrite, but medium integration risk

Why the risk is medium:

- the official AWS SDK is large and compatibility-heavy
- bearer-token auth is a less common path than standard AWS credential flows
- this must be proven under Deno rather than assumed

Best replacement strategy:

- first choice: keep `@aws-sdk/client-bedrock-runtime`
- fallback: only replace if the spike proves the bearer-token path unreliable under Deno

### 9. Tests

#### `tests/*.test.ts`

Current role:

- full suite uses `bun:test`
- current mocking strategy depends on Bun's test API

Why this is major work:

- every test file changes
- setup and mocking ergonomics change
- test watch flow changes

Best Deno replacement options:

- primary: `Deno.test` plus standard assertions and `@std/testing/mock`-style helpers
- alternative: preserve an external runner such as Vitest only if Deno-native testing is not ergonomic enough

Recommendation:

- prefer native `Deno.test` first
- do not introduce Vitest unless native Deno testing proves too weak for the mocking needs

### 10. Containers, docs, and operator workflow

#### `Dockerfile`

Current role:

- uses `oven/bun:1-alpine`
- installs `git` and `ripgrep`
- runs `bun install --production`
- starts with `bun run src/index.ts`

Required rewrite:

- switch to a Deno base image
- pre-cache dependencies with Deno
- start the server with explicit permission flags

Representative Deno runtime shape:

```bash
deno run \
  --allow-net \
  --allow-env \
  --allow-read=/app,/tmp/repo_cache \
  --allow-write=/app/logs,/tmp/repo_cache \
  --allow-run=git,rg \
  --env-file=.env \
  src/index.ts
```

#### `docker-compose.yml`, README, and guides

Required rewrite:

- operator instructions
- install steps
- tunnel/debug guidance where runtime commands appear
- development commands
- CI examples

## Likely Deno Replacements By Concern

| Concern | Current | Best Deno Choice | Notes |
|---|---|---|---|
| Server | Hono on Bun | Hono on Deno | Keep |
| Validation | Zod | Zod | Keep |
| Logging | LogTape | LogTape first, `@std/log` fallback | Keep if compatibility is solid |
| Bedrock | AWS SDK | AWS SDK first | Verify bearer-token auth path |
| GitLab API | `@gitbeaker/rest` | Keep if spike passes; otherwise direct `fetch` wrapper | Wrapper boundary already exists |
| YAML | `Bun.YAML.parse()` | `jsr:@std/yaml` | Straight replacement |
| UUID | `Bun.randomUUIDv7()` | `crypto.randomUUID()` or `uuid` v7 | Likely minor |
| Files | `Bun.file()` | `Deno.readTextFile()` | Straight replacement |
| Subprocesses | `Bun.spawn()` | `Deno.Command` | Key migration surface |
| Env loading | Bun auto env | `--env-file` + `Deno.env` | Explicit, auditable |
| Package/tasks | Bun scripts | `deno.json` tasks | Replace |
| Testing | `bun:test` | `Deno.test` | Rewrite needed |

## Security Evaluation: What Deno Actually Improves

### Real benefits

- limits accidental filesystem access outside declared paths
- limits accidental egress to undeclared hosts when `--allow-net` is scoped tightly
- limits subprocess execution to declared binaries such as `git` and `rg`
- makes secrets access explicit through `--allow-env`
- creates a runtime contract operators can inspect and audit

### Limits

- does not replace application-level validation
- does not replace SSRF and host-validation logic in repo cloning
- does not replace GitLab token scoping and secret management
- does not replace container or host hardening
- loses value if permissions become too broad, for example unrestricted `--allow-net`

### Security conclusion

Deno would improve GitGandalf's runtime security posture, but only if the team
actually treats permission scoping as a first-class deployment artifact.

If the final deployment simply grants broad network, read, write, env, and run
permissions to the whole container filesystem and all outbound hosts, the security
improvement becomes much smaller.

## Performance And Operational Tradeoffs

### Potential benefits

- explicit runtime contract for operators
- strong built-in tasking and test tooling
- easier justification to security-conscious platform teams

### Potential costs

- no guaranteed performance win over Bun for this workload
- likely slower migration velocity in the near term
- test migration cost is real
- some npm packages may work but feel less native in Deno operations
- team will need new operational muscle memory for permissions and tasks

### Practical conclusion

This should be justified on security and runtime governance, not on speed.

## Proposed Migration Strategy

### Phase D0 — Decision gate

Before any code migration, align on the goal.

Questions to settle:

- Is the priority runtime least privilege for self-hosted environments?
- Is the team willing to rewrite the test suite and operator workflow now?
- Are current roadmap items less important than runtime hardening?
- Is a partial portability cleanup acceptable even if the runtime does not switch yet?

### Phase D1 — Feasibility spike

Build a thin Deno branch that proves a vertical slice end to end:

- Hono server boots under Deno
- webhook route validates and responds
- one Bedrock call succeeds
- one GitLab API call succeeds
- one repo clone via `git` succeeds
- one `rg` search tool succeeds
- one summary note posts successfully

Required output of the spike:

- exact Deno permission flags
- list of packages that work unchanged
- list of packages that need replacement
- baseline metrics vs Bun
- explicit go/no-go recommendation

### Phase D2 — Runtime and tooling foundation

If the spike passes:

- add `deno.json`
- define `deno task dev`, `test`, `check`, `typecheck`, and `start`
- add lockfile handling
- update Dockerfile and compose
- replace Bun-only APIs with Deno/native APIs

### Phase D3 — Application migration

Port the app module by module while preserving behavior:

- bootstrap and config
- logger
- router and pipeline
- repo manager
- tools
- prompt loader
- llm client fallback IDs

Keep these boundaries stable:

- internal protocol in `src/agents/protocol.ts`
- Zod schemas
- GitLab wrapper contract
- publisher behavior

### Phase D4 — Test migration

Rebuild the full suite under Deno.

This phase is complete only when:

- all current test areas exist again
- mocks/spies cover failure paths as they do today
- subprocess-heavy paths are exercised
- prompt loading and logging are covered

### Phase D5 — Dual-runtime comparison and rollout

Before retirement of Bun:

- run Deno in a staging-like environment
- compare logs, findings, latency, and failure modes
- validate permissions are narrow enough to be worth the move
- update docs and active plans only after the decision is approved

## Go/No-Go Criteria

Approve the migration only if all of the following are true:

1. Bedrock bearer-token auth works reliably under Deno.
2. GitLab API integration is either stable with `@gitbeaker/rest` or cheaply replaceable.
3. `git` and `rg` execution are reliable through `Deno.Command`.
4. The full test suite can be restored without introducing a worse third-party test stack.
5. The production permission set is meaningfully narrower than Bun's implicit trust model.
6. Team operational overhead is acceptable.

Reject or defer the migration if any of the following is true:

1. The AWS or GitLab integrations become fragile under npm compatibility.
2. The permission set must be so broad that the security gain is mostly theoretical.
3. Test migration cost would materially delay more important roadmap work.
4. The spike shows no meaningful operational or security improvement in practice.

## Suggested Success Metrics

- Deno permission flags are scoped to specific paths, binaries, env keys, and hosts
- webhook-to-review pipeline still succeeds end to end
- review quality is unchanged
- no regression in diff anchoring, duplicate detection, or summary publishing
- no regression in repo sandbox guarantees
- operator setup remains understandable
- local development remains one-command practical

## Final Assessment

A Deno migration is plausible for GitGandalf.

The architecture is not trapped in Bun. Hono, Zod, the internal protocol, and the
wrapper boundaries around Bedrock and GitLab all help.

But the migration is still substantial because the repo chose Bun intentionally for:

- subprocess ergonomics
- built-in test runner
- runtime bootstrap simplicity
- developer workflow simplicity
- file and YAML utilities

The best next move is not “rewrite everything for Deno now.”

The best next move is a focused feasibility spike that answers one decisive question:

> Does Deno give GitGandalf a materially better security and operations story,
> after accounting for the broad permissions this service still requires?

If the answer is yes, this plan becomes the migration roadmap.
If the answer is no, the repo should stay on Bun and instead adopt narrower
hardening measures within the current runtime and container model.
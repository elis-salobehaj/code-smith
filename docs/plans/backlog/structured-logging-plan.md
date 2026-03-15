---
title: "Structured Logging for GitGandalf"
status: backlog
priority: medium
estimated_hours: 6-10
dependencies: []
created: 2026-03-14
date_updated: 2026-03-14

related_files:
  - src/index.ts
  - src/config.ts
  - src/api/router.ts
  - src/api/pipeline.ts
  - src/agents/orchestrator.ts
  - src/publisher/gitlab-publisher.ts
  - docs/README.md
  - docs/agents/README.md
  - docs/agents/context/ARCHITECTURE.md
  - docs/agents/context/CONFIGURATION.md
  - docs/agents/context/WORKFLOWS.md
  - docs/humans/README.md
  - docs/humans/context/ARCHITECTURE.md
  - docs/guides/GETTING_STARTED.md
  - docs/guides/DEVELOPMENT.md

tags:
  - logging
  - observability
  - infrastructure
  - logtape
---

# Structured Logging for GitGandalf

## Resolved Decisions

| Decision | Answer | Rationale |
|---|---|---|
| **Deployment scope** | Docker/K8s today; ECS/Fargate and edge runtimes possible | Multi-runtime logging matters — rules out Node-only libraries |
| **Observability stack** | OTel and Sentry are in the picture going forward | Not necessarily Phase 5, but the logging layer must not block future sink adoption |
| **Library choice** | **LogTape** (`@logtape/logtape` + `@logtape/hono`) | Zero-dep, Bun-native, first-party Hono middleware, `withContext()` for request correlation, drop-in OTel/Sentry sinks when needed |

## Problem Statement

GitGandalf has 13 ad-hoc `console.*` calls scattered across 4 modules, each
manually prefixed with `[module]` tags. The `LOG_LEVEL` env var is parsed by Zod
in `src/config.ts` but **not wired to anything**. The only structured logging is
Hono's built-in `logger()` middleware in `src/index.ts`, which outputs
unstructured `<-- method path` / `--> method path status time` lines.

### Current Pain Points

1. **No level filtering** — `LOG_LEVEL` is ghost config; all console output
   always emits regardless of configured level.
2. **No structured output** — Log lines are plain strings, not JSON. This makes
   log aggregation, querying, and alerting harder in Docker/K8s environments.
3. **No request correlation** — No request ID propagation; impossible to trace
   a single webhook through the multi-agent pipeline.
4. **Inconsistent format** — Some calls use template literals, some use comma
   separation, some include error objects. No contract for what a log line
   looks like.

## Why LogTape and Not a Thin Console Wrapper

### Bun's `console` Is Fast — But That's Not the Whole Story

In Node.js, `console.log()` is synchronous and blocks the event loop — this is
the original reason Pino was invented. In **Bun**, the `console` object is
implemented in highly optimized Zig, is asynchronous under the hood, and
benchmarks close to Pino's raw throughput. A 40-line custom wrapper over
`console` + `JSON.stringify` with level gating would wire up `LOG_LEVEL` and
give structured JSON with zero deps.

**However**, for GitGandalf specifically that approach falls short:

1. **Request correlation** — the webhook → pipeline → orchestrator → agents →
   publisher flow crosses multiple async boundaries. Building `withContext()`
   + `AsyncLocalStorage` propagation by hand is exactly the kind of plumbing
   LogTape provides out of the box.
2. **Future OTel/Sentry sinks** — a console wrapper means writing a new
   transport layer when observability tooling arrives. LogTape's
   `@logtape/otel` and `@logtape/sentry` are drop-in packages.
3. **Multi-runtime portability** — with ECS/Fargate and potential edge runtimes
   on the roadmap, LogTape's Web-Standards-only approach keeps us portable
   without polyfills.

### Why LogTape Over Pino/Winston

| Criterion | LogTape | Pino | Winston |
|---|---|---|---|
| **Dependencies** | 0 | 1 | 17 |
| **Bundle size** | 5.3 KB | 3.1 KB | 38.3 KB |
| **Bun support** | Native (Web APIs) | Compat layer | Compat layer |
| **Hono middleware** | `@logtape/hono` (first-party) | Manual | Manual |
| **Console perf (ns/iter)** | 214–236 | 302–874 | 1,770–3,370 |
| **Disabled-log overhead** | 163 ns | 570 ns | 701 ns |
| **Structured logging** | Built-in | Built-in | Via `format.json()` |
| **Hierarchical categories** | Native | Child loggers | Child loggers |
| **OpenTelemetry sink** | `@logtape/otel` | `pino-opentelemetry-transport` | `winston-transport-otel` |
| **Sentry sink** | `@logtape/sentry` | Manual | `winston-sentry-log` |
| **Data redaction** | `@logtape/redaction` | Built-in `redact` | Manual |
| **Multi-runtime** | Bun/Deno/Node/Edge/Browser | Node (compat elsewhere) | Node only |

### What LogTape Buys Us Specifically

1. **`@logtape/hono` middleware** — drop-in replacement for `hono/logger` that
   produces structured JSON with method, path, status, response time, and
   content length.

2. **Hierarchical categories** — `["gandalf", "pipeline"]`, `["gandalf",
   "orchestrator"]`, `["gandalf", "publisher"]` etc. Parent-level config
   controls all children. Wire `config.LOG_LEVEL` once.

3. **Request context propagation** — `withContext({ requestId, projectId,
   mrIid })` makes every log line in the webhook-to-publish flow traceable.
   Uses `AsyncLocalStorage` under the hood.

4. **Sink composability** — Start with `getConsoleSink()` for stdout JSON.
   Later add `@logtape/otel` or `@logtape/sentry` without changing any
   call sites.

5. **Template literal logging** — `logger.info\`Review complete: ${verdict}
   (${count} findings)\`` is more readable than string concatenation and
   enables lazy evaluation (message isn't formatted if level is filtered).

6. **Zero-dep, zero-risk** — Aligns with the project's Bun-native, minimal
   dependency philosophy. No transitive supply chain to audit.

---

## Implementation Plan

### Category Convention

All loggers use hierarchical categories rooted at `"gandalf"`:

| Module | Category |
|---|---|
| `src/index.ts` / Hono HTTP | `["gandalf", "http"]` |
| `src/api/router.ts` | `["gandalf", "router"]` |
| `src/api/pipeline.ts` | `["gandalf", "pipeline"]` |
| `src/agents/orchestrator.ts` | `["gandalf", "orchestrator"]` |
| `src/agents/context-agent.ts` | `["gandalf", "agent", "context"]` |
| `src/agents/investigator-agent.ts` | `["gandalf", "agent", "investigator"]` |
| `src/agents/reflection-agent.ts` | `["gandalf", "agent", "reflection"]` |
| `src/publisher/gitlab-publisher.ts` | `["gandalf", "publisher"]` |

This allows a single config line `{ category: ["gandalf"], lowestLevel: config.LOG_LEVEL, sinks: ["console"] }`
to control the entire application, with per-subsystem overrides possible.

---

### Phase L1: Core LogTape Setup

**Goal:** Install LogTape, create the centralized logging configuration module,
and wire `config.LOG_LEVEL` so it actually controls log output.

#### Tasks

- [ ] **L1.1** — Install dependencies:
  ```bash
  bun add @logtape/logtape @logtape/hono
  ```

- [ ] **L1.2** — Create `src/logger.ts` with the following responsibilities:
  - Import `configure`, `getConsoleSink`, `getLogger` from `@logtape/logtape`
  - Import `AsyncLocalStorage` from `node:async_hooks` (Bun supports this)
  - Define and export an `initLogging()` async function that calls `configure()`:
    - Sink: `getConsoleSink({ formatter: jsonLinesFormatter })` for structured
      JSON to stdout
    - Logger: `{ category: ["gandalf"], lowestLevel: config.LOG_LEVEL, sinks: ["console"] }`
    - Set `contextLocalStorage: new AsyncLocalStorage()` for implicit context
  - Re-export `getLogger` and `withContext` from `@logtape/logtape` for
    convenient import across the codebase
  - Export a convenience `resetLogging()` that calls `dispose()` — used in
    tests to cleanly tear down

- [ ] **L1.3** — Call `await initLogging()` in `src/index.ts` **before** the
  Hono app is created, so all subsequent logger calls have the configured sinks
  available.

- [ ] **L1.4** — Verify locally: start the server with `bun run dev`, confirm
  that the existing `hono/logger` output still works and the new LogTape setup
  does not error.

#### Docs Overhaul — Phase L1

- [ ] **L1.5** — Update `docs/agents/context/CONFIGURATION.md`:
  - Change the `LOG_LEVEL` row from "Parsed today but not yet wired to a
    structured logger" to "Wired to LogTape via `src/logger.ts`. Controls the
    `lowestLevel` of the root `["gandalf"]` logger category."
- [ ] **L1.6** — Update `docs/agents/context/ARCHITECTURE.md`:
  - Add `src/logger.ts` to the "Current Runtime Surface" list with description:
    "LogTape configuration, `initLogging()` setup, re-exports `getLogger` and
    `withContext` for the codebase."
- [ ] **L1.7** — Update `docs/humans/context/ARCHITECTURE.md`:
  - Add `src/logger.ts` to the directory structure tree
  - Add a new subsection under "Implemented Components" titled
    "Structured logging" explaining LogTape, hierarchical categories, the
    console JSON sink, and `LOG_LEVEL` wiring
- [ ] **L1.8** — Update `docs/guides/GETTING_STARTED.md`:
  - In "Understand the current scope" add "Structured logging via LogTape
    with level filtering" to the implemented list
- [ ] **L1.9** — Update `docs/guides/DEVELOPMENT.md`:
  - Add a "Logging conventions" section documenting: use `getLogger()` from
    `src/logger.ts`, never use bare `console.*` in source code, category naming
    convention (`["gandalf", "<module>"]`)
- [ ] **L1.10** — Update `docs/README.md`:
  - In "Implemented today" list, add "Structured logging via LogTape with
    `LOG_LEVEL` filtering and hierarchical categories"

---

### Phase L2: Hono HTTP Middleware Replacement

**Goal:** Replace the built-in `hono/logger` with `@logtape/hono` so HTTP
request/response logging is structured JSON rather than plain text.

#### Tasks

- [ ] **L2.1** — In `src/index.ts`:
  - Remove `import { logger } from "hono/logger"`
  - Import `{ honoLogger }` from `@logtape/hono`
  - Replace `app.use("*", logger())` with:
    ```typescript
    app.use(honoLogger({
      category: ["gandalf", "http"],
      level: "info",
      format: "combined",
      skip: (c) => c.req.path === "/api/v1/health",
    }));
    ```
  - The `skip` function excludes health check noise from logs.

- [ ] **L2.2** — Verify structured JSON output: start the server, `curl` the
  webhook endpoint and the health endpoint. Confirm:
  - Webhook requests produce a JSON log line with `method`, `path`, `status`,
    `responseTime` fields
  - Health check requests produce no log line (skipped)

- [ ] **L2.3** — Run `bun test` — the existing webhook tests must still pass
  unchanged. If any test relied on capturing `hono/logger` output, update it.

#### Docs Overhaul — Phase L2

- [ ] **L2.4** — Update `docs/agents/context/ARCHITECTURE.md`:
  - Change the `src/index.ts` description from "enables request logging" to
    "enables structured HTTP request logging via `@logtape/hono` middleware
    (JSON Lines output, health check excluded)"
- [ ] **L2.5** — Update `docs/humans/context/ARCHITECTURE.md`:
  - Update the "Hono server" section under "Implemented Components" to mention
    `@logtape/hono` structured middleware replacing the built-in `hono/logger`
  - Update the Mermaid diagram: change `H[console log only]` to reflect the
    new structured logging path
- [ ] **L2.6** — Update `docs/agents/context/WORKFLOWS.md`:
  - In section "1. Webhook Ingestion", add a note that HTTP request/response
    logging is handled automatically by `@logtape/hono` middleware and
    emits structured JSON to stdout

---

### Phase L3: Module-by-Module Console Migration

**Goal:** Replace all 13 ad-hoc `console.*` calls with LogTape loggers using
the hierarchical category convention. After this phase, **zero** `console.*`
calls remain in production source code.

#### Tasks

- [ ] **L3.1** — Migrate `src/api/router.ts` (2 calls):
  - Add `const logger = getLogger(["gandalf", "router"])` at module scope
  - Replace `console.warn("[webhook] Payload validation failed:", ...)` with
    `logger.warn("Payload validation failed: {error}", { error: result.error.message })`
  - Replace `console.error("[pipeline] Unhandled error:", err)` with
    `logger.error("Unhandled pipeline error", { error: err instanceof Error ? err.message : String(err) })`
  - Remove the manual `[webhook]` / `[pipeline]` prefixes — the category
    system handles module identification.

- [ ] **L3.2** — Migrate `src/api/pipeline.ts` (2 calls):
  - Add `const logger = getLogger(["gandalf", "pipeline"])` at module scope
  - Replace the `console.log` at pipeline start with
    `logger.info("Starting review for MR", { projectId, mrIid })`
  - Replace the `console.log` at pipeline end with
    `logger.info("Review complete", { verdict: state.summaryVerdict, findings: state.verifiedFindings.length })`

- [ ] **L3.3** — Migrate `src/agents/orchestrator.ts` (5 calls):
  - Add `const logger = getLogger(["gandalf", "orchestrator"])` at module scope
  - Replace each `console.log("[orchestrator] ...")` with the corresponding
    LogTape call:
    - `"Starting review pipeline"` → `logger.info("Starting review pipeline")`
    - `"Agent 1: Context & Intent"` → `logger.info("Running Agent 1: Context & Intent")`
    - `"Agent 2: Socratic Investigation"` → `logger.info("Running Agent 2: Socratic Investigation")`
    - `"Agent 3: Reflection & Consolidation"` → `logger.info("Running Agent 3: Reflection & Consolidation")`
    - `"Re-investigation requested"` → `logger.info("Re-investigation requested — looping back to Agent 2")`
    - `"Review complete: ..."` → `logger.info("Review complete", { verdict: state.summaryVerdict, findings: state.verifiedFindings.length })`

- [ ] **L3.4** — Migrate `src/publisher/gitlab-publisher.ts` (3 calls):
  - Add `const logger = getLogger(["gandalf", "publisher"])` at module scope
  - Replace `console.warn("[publisher] Skipping non-diff finding: ...")` with
    `logger.warn("Skipping non-diff finding", { title: finding.title, file: finding.file, lineStart: finding.lineStart, lineEnd: finding.lineEnd })`
  - Replace `console.log("[publisher] Skipping duplicate finding: ...")` with
    `logger.debug("Skipping duplicate finding", { title: finding.title, file: finding.file, lineStart: finding.lineStart })`
    (note: changed from `info` to `debug` — duplicates are noise at info level)
  - Replace `console.warn("[publisher] Failed to post finding ...")` with
    `logger.error("Failed to post finding", { title: finding.title, error: error instanceof Error ? error.message : String(error) })`

- [ ] **L3.5** — Run a project-wide grep to confirm zero remaining `console.`
  calls in `src/`:
  ```bash
  grep -rn "console\." src/ --include="*.ts"
  ```
  If any remain, migrate them.

- [ ] **L3.6** — Add a Biome lint rule or comment convention to discourage
  future `console.*` usage in `src/` (optional — document the convention at
  minimum).

- [ ] **L3.7** — Run the full validation suite:
  ```bash
  bun run check && bun run typecheck && bun test
  ```

#### Docs Overhaul — Phase L3

- [ ] **L3.8** — Update `docs/agents/context/ARCHITECTURE.md`:
  - In the "Webhook Flow" section, replace any mention of console logging
    with "logged via LogTape structured logger"
  - Update the line "Called fire-and-forget by the router; errors are logged
    at the call site" to reference LogTape categories
- [ ] **L3.9** — Update `docs/agents/context/WORKFLOWS.md`:
  - In section "4. Current Pipeline Boundary", remove or update the text
    "`src/api/pipeline.ts` is still a stub. The current workflow ends at
    logging" — this description is stale (Phase 4 is complete) and the
    logging reference should mention structured LogTape output
  - In section "5. Standalone Agent Review Workflow", note that each agent
    stage emits structured logs under `["gandalf", "orchestrator"]` /
    `["gandalf", "agent", "*"]` categories
- [ ] **L3.10** — Update `docs/humans/context/ARCHITECTURE.md`:
  - Refresh the Mermaid diagram to remove `H[console log only]` and show
    the structured logging flow
  - Update the Phase Ownership table if necessary (logging is now an
    implemented cross-cutting concern, not owned by a single phase)
- [ ] **L3.11** — Update `docs/guides/DEVELOPMENT.md`:
  - Expand the "Logging conventions" section (added in L1.9) with concrete
    examples of the migrated patterns: structured properties, error handling,
    and how to add a logger to a new module
- [ ] **L3.12** — Update `docs/agents/README.md`:
  - Add a bullet point referencing the logging convention documentation

---

### Phase L4: Request Correlation & Context Propagation

**Goal:** Generate a unique `requestId` per incoming webhook and propagate it
through `withContext()` so every log line in the entire webhook → pipeline →
orchestrator → agents → publisher flow is traceable.

#### Tasks

- [ ] **L4.1** — In `src/api/router.ts`, at the start of the webhook handler
  (after auth and validation succeed), generate a request ID:
  ```typescript
  const requestId = crypto.randomUUID();
  ```

- [ ] **L4.2** — Wrap the `runPipeline()` call in `withContext()`:
  ```typescript
  import { withContext } from "../logger.js";

  // Inside the handler, after validation:
  withContext({ requestId }, () => {
    runPipeline(event);
  });
  ```
  This ensures every log line emitted during pipeline execution — across all
  agents and the publisher — automatically includes the `requestId` field
  in its structured JSON output.

- [ ] **L4.3** — Enrich the pipeline context: in `src/api/pipeline.ts`, add
  `projectId` and `mrIid` to the implicit context at pipeline entry:
  ```typescript
  await withContext({ projectId, mrIid }, async () => {
    // ... entire pipeline body
  });
  ```
  Now all downstream logs (orchestrator, agents, publisher) carry
  `requestId` + `projectId` + `mrIid` without any of those modules needing
  to know about request correlation.

- [ ] **L4.4** — Verify context propagation: start the server, send a test
  webhook via `curl`, and inspect stdout. Every JSON log line from router →
  pipeline → orchestrator → publisher should include the same `requestId`
  value, plus `projectId` and `mrIid` where applicable.

- [ ] **L4.5** — Run the full validation suite:
  ```bash
  bun run check && bun run typecheck && bun test
  ```

#### Docs Overhaul — Phase L4

- [ ] **L4.6** — Update `docs/agents/context/ARCHITECTURE.md`:
  - Add a new subsection "Request Correlation" under the webhook flow or as a
    standalone section. Explain: `requestId` generated in router, propagated
    via `withContext()`, all downstream logs carry `requestId`, `projectId`,
    and `mrIid` automatically.
- [ ] **L4.7** — Update `docs/agents/context/WORKFLOWS.md`:
  - In "1. Webhook Ingestion", add step between token verification and
    pipeline dispatch: "generate `requestId` via `crypto.randomUUID()` and
    propagate via LogTape `withContext()`"
  - In "5. Standalone Agent Review Workflow" (or the full pipeline workflow),
    note that all log output carries request correlation fields
- [ ] **L4.8** — Update `docs/humans/context/ARCHITECTURE.md`:
  - Expand the "Structured logging" section (added in L1.7) with a
    description of implicit context propagation and the fields carried
  - Update the Mermaid diagram to show `requestId` flow if it adds clarity
- [ ] **L4.9** — Update `docs/guides/DEVELOPMENT.md`:
  - In "Logging conventions", add a subsection on context propagation:
    how `withContext()` works, what fields are available, and how to add
    custom context in new modules
- [ ] **L4.10** — Update `docs/guides/GETTING_STARTED.md`:
  - In the "Send a sample webhook" section, update "Current behavior" to
    mention that each request is logged with a unique `requestId` and
    `projectId` / `mrIid` for traceability

---

### Phase L5: Test Infrastructure & Final Validation

**Goal:** Ensure the logging setup does not break existing tests, add test
utilities for capturing/asserting log output, and do the final documentation
pass.

#### Tasks

- [ ] **L5.1** — Create or update test setup for LogTape:
  - Before the test suite runs, call `initLogging()` with a test-appropriate
    configuration (either a no-op sink or a capturing sink)
  - Alternatively, call `configure()` with `reset: true` in a
    `beforeAll`/`afterAll` to prevent LogTape warnings about reconfiguration
  - Use LogTape's `getTestSink()` if available, or a custom sink that
    pushes records to an array for assertion

- [ ] **L5.2** — Verify all 48+ existing tests still pass:
  ```bash
  bun test
  ```

- [ ] **L5.3** — Add targeted logging tests (in a new `tests/logger.test.ts`
  or within relevant test files):
  - Test that log output respects `LOG_LEVEL` filtering (set level to `warn`,
    emit an `info` log, confirm no output)
  - Test that `withContext()` fields appear in captured log records
  - Test that the category hierarchy works as expected

- [ ] **L5.4** — Run `bun run check` to confirm Biome compliance across all
  changed files.

- [ ] **L5.5** — Run `bun run typecheck` to confirm no TypeScript errors.

#### Docs Overhaul — Phase L5 (Final Pass)

- [ ] **L5.6** — Update `docs/README.md`:
  - Ensure the "Current State Summary" section's "Implemented today" list
    includes structured logging as a line item
  - Review the "Planned next" list — remove any logging-related items if they
    were listed there
- [ ] **L5.7** — Update `docs/agents/README.md`:
  - Confirm the logging convention reference (added in L3.12) is accurate
    and points to the right development guide section
- [ ] **L5.8** — Update `docs/humans/README.md`:
  - If the humans/ docs now cover logging in ARCHITECTURE.md, ensure the
    README's "Available Docs" section's Architecture description mentions
    logging/observability
- [ ] **L5.9** — Final review pass across **all** docs under `docs/`:
  - `docs/README.md`
  - `docs/agents/README.md`
  - `docs/agents/context/ARCHITECTURE.md`
  - `docs/agents/context/CONFIGURATION.md`
  - `docs/agents/context/WORKFLOWS.md`
  - `docs/humans/README.md`
  - `docs/humans/context/ARCHITECTURE.md`
  - `docs/guides/GETTING_STARTED.md`
  - `docs/guides/DEVELOPMENT.md`
  Confirm no stale references to `console.log`, `hono/logger`, or "not yet
  wired" remain. Grep for these terms and fix any stragglers.
- [ ] **L5.10** — Update this plan file: mark all phases complete, move from
  `docs/plans/backlog/` to `docs/plans/implemented/` when done.

---

## Files Changed (Complete List)

| File | Change | Phase |
|---|---|---|
| `package.json` | Add `@logtape/logtape`, `@logtape/hono` | L1 |
| `src/logger.ts` | **New** — LogTape configuration, `initLogging()`, re-exports | L1 |
| `src/index.ts` | Call `initLogging()`, replace `hono/logger` with `@logtape/hono` | L1, L2 |
| `src/config.ts` | No code change; LOG_LEVEL already parsed | — |
| `src/api/router.ts` | Replace 2 console calls, add requestId + withContext | L3, L4 |
| `src/api/pipeline.ts` | Replace 2 console calls, add withContext for projectId/mrIid | L3, L4 |
| `src/agents/orchestrator.ts` | Replace 5 console calls | L3 |
| `src/publisher/gitlab-publisher.ts` | Replace 3 console calls | L3 |
| `tests/logger.test.ts` | **New** — LogTape level filtering and context tests | L5 |
| `docs/README.md` | Add logging to implemented features list | L1, L5 |
| `docs/agents/README.md` | Add logging convention reference | L3, L5 |
| `docs/agents/context/ARCHITECTURE.md` | Add logger.ts, structured logging, request correlation | L1, L2, L3, L4 |
| `docs/agents/context/CONFIGURATION.md` | Mark LOG_LEVEL as wired to LogTape | L1 |
| `docs/agents/context/WORKFLOWS.md` | Update webhook flow & pipeline workflow with logging details | L2, L3, L4 |
| `docs/humans/README.md` | Update Architecture description | L5 |
| `docs/humans/context/ARCHITECTURE.md` | Add logging section, update Mermaid diagram, directory tree | L1, L2, L3, L4 |
| `docs/guides/GETTING_STARTED.md` | Update scope description, note structured logging | L1, L4 |
| `docs/guides/DEVELOPMENT.md` | Add logging conventions section, context propagation guide | L1, L3, L4 |

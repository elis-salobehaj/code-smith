# CodeSmith Documentation

## Core Context (`docs/context/`)

Unified reference documentation for both humans and agents. These docs lean toward the more explanatory human style while remaining precise enough for implementation work.

- [Architecture](./context/ARCHITECTURE.md) — Current implemented architecture, runtime surfaces, operational behavior, planned boundaries, and rationale
- [Configuration](./context/CONFIGURATION.md) — Environment variables, repo-level `.codesmith.yaml` config, defaults, validation, and test-env notes
- [Workflows](./context/WORKFLOWS.md) — Implemented webhook flow, repo cache workflow, tool execution, full review workflow, and logging/observability behavior

## Design Docs (`docs/designs/`)

- [Multi-Agent Architecture](./designs/multi-agent-architecture.md) — Agent pipeline diagram, per-agent inputs/outputs, data flow, known issues, and proposed improvements
- [Tech Stack Design](./designs/tech-stack-evaluation.md) — Current stack decision record and provider-boundary rationale

## 📚 Guides (`docs/guides/`)

- [Getting Started](./guides/GETTING_STARTED.md) — Local setup, env configuration, GitLab token/webhook secret creation, webhook reachability, Jira prep, queue and provider fallback setup, KinD bootstrap, health check, and sample webhook flow
- [Development](./guides/DEVELOPMENT.md) — Bun commands, KinD helper scripts, testing strategy, logging conventions, plan-driven workflow, and tool-module conventions
- [Repo Review Config](./guides/REPO_REVIEW_CONFIG.md) — What `.codesmith.yaml` is, how to author it, current support status, schema reference, examples, and troubleshooting

## 📋 Implementation Plans (`docs/plans/`)

- **Active**: [CodeSmith Master Plan](./plans/active/code-smith-master-plan.md) — Phases 1–5 complete (Phase 5.5 DEFERRED), with Jira write actions deferred to Phase 6
- **Active**: [CodeSmith Awakening Personality Plan](./plans/active/CodeSmith-awakening-personality-plan.md) — Trigger alias expansion, CodeSmith-mode acknowledgements, and tone-aware top-level summary behavior
- **Active**: [The Crown Plan](./plans/active/code-smith-crown-plan.md) — Master umbrella plan to close all competitive gaps with CodeRabbit and GitLab Duo across 6 primary child plans plus a threshold-driven PostgreSQL/pgvector migration path
- **Backlog**: [CP1 — Repo-Based Review Configuration](./plans/backlog/repo-review-config-plan.md) — `.codesmith.yaml` repo-level config plan. Phase C1 is implemented today (schema, loader, defaults, validation, tests) and the repo-author guide now exists; pipeline integration and prompt injection remain pending.
- **Backlog**: [CP2 — Linter & SAST Integration](./plans/backlog/linter-sast-integration-plan.md) — Auto-detect and run Biome plus instance-owned standalone analysis profiles against changed files, with explicit subprocess sandbox controls, normalized findings, and agent/publisher integration
- **Backlog**: [CP3 — Organizational Learning](./plans/backlog/organizational-learning-plan.md) — Feedback capture (reactions, applied suggestions), singleton ops-owned SQLite learning DB, persisted sync cursors, durable write jobs, and prompt injection for future reviews
- **Backlog**: [CP4 — Enhanced Review Output](./plans/backlog/enhanced-review-output-plan.md) — Smart MR summaries, file-by-file walkthroughs, improved suggestion formatting and one-click fix UX
- **Backlog**: [CP5 — Analytics & Observability](./plans/backlog/analytics-observability-plan.md) — Prometheus metrics, SQLite analytics, REST API for review trends, Grafana dashboard template
- **Backlog**: [CP6 — Production Hardening & DX](./plans/backlog/production-hardening-plan.md) — Helm chart, HPA, health probes, circuit breakers, benchmarks, E2E tests, contributor guide, operational runbook
- **Backlog**: [CP7 — PostgreSQL & pgvector Migration Path](./plans/backlog/postgresql-pgvector-migration-plan.md) — Threshold-driven migration from phase-one SQLite storage to PostgreSQL, with optional pgvector only when semantic retrieval is justified
- **Backlog**: [Deno Runtime Evaluation And Migration Plan](./plans/backlog/deno-runtime-evaluation-and-migration-plan.md) — Security-first runtime evaluation, Bun-to-Deno rewrite scope, replacement matrix, and spike-first migration path
- **Implemented**: [Review Edge Cases Hardening](./plans/implemented/review-edge-cases-hardening.md) — Same-head idempotency, review ledger + incremental ranges, publication semantics, full-pipeline branch serialization, repo freshness validation, metadata-only update skipping, and explicit draft policy
- **Implemented**: [Structured Logging](./plans/implemented/structured-logging-plan.md) — LogTape structured logging, request correlation, and docs overhaul across 5 phases
- **Implemented**: [Agentic Development Plan](./plans/implemented/agentic-development-plan.md) — Repo bootstrap and dev tooling setup

### Implementation Status

| Phase | Status | Summary |
|---|---|---|
| **Phase 1** | ✅ Complete | Hono server, Zod webhook parsing, GitLab client wrapper, health and webhook endpoints |
| **Phase 2** | ✅ Complete | Repo cache manager, tool executor, file/search/directory tools, and test coverage foundation |
| **Phase 2.5** | ✅ Complete | Tool-per-file modularization with stable barrel import path in `src/context/tools/` |
| **Phase 3** | ✅ Complete | Shared review state, internal protocol, Bedrock Runtime adapter, context/investigator/reflection agents, orchestrator, and Phase 3 test coverage |
| **Phase 4** | ✅ Complete | GitLab publisher (inline comments, summary note, duplicate guard), full pipeline wiring, Dockerfile, Docker Compose, README |
| **Phase 4.5** | ✅ Complete | Jira read-only client, ticket-key extraction from MR title/description, pipeline enrichment, Agent 1 prompt context, ADF description parsing, acceptance-criteria custom-field support |
| **Phase 4.6** | ✅ Complete | `GITLAB_CA_FILE` TLS/custom-CA support for self-hosted GitLab; `buildGitEnv()` injects `GIT_SSL_CAINFO` into git spawns; `NODE_EXTRA_CA_CERTS` set at startup for API client; host validation and auth documented; deployment matrix in GETTING_STARTED.md |
| **Logging** | ✅ Complete | LogTape structured logging, `LOG_LEVEL` wired, `@logtape/hono` middleware, request correlation via `withContext()`, debug log file at `logs/codesmith-dev.log` |
| **Phase 5** | ✅ Complete | BullMQ+Valkey task queue with retries, timeout boundary, dead-letter handling, Kubernetes manifests, and multi-provider LLM fallback (OpenAI/Google) |
| **Crown Plan** | ⬜ Planned | 6 primary child plans to close competitive gaps, plus CP7 as the threshold-driven future migration path from SQLite to PostgreSQL/pgvector |

## Current State Summary

Implemented today:

- webhook ingestion and filtering
- required-field Zod payload validation with permissive GitLab key handling
- GitLab data access wrapper
- repo cache manager with host validation
- modular tool surface for investigator agents
- internal agent and tool protocol owned by CodeSmith
- integrated multi-agent review pipeline with context, investigator, reflection, and orchestration stages
- end-to-end pipeline: webhook → agents → GitLab inline comments + summary note
- GitLab publisher with duplicate detection
- Dockerfile and Docker Compose for self-hosted deployment
- structured logging via LogTape (JSON Lines, `LOG_LEVEL` filtering, request correlation, debug file output)
- Jira read-only ticket enrichment: key extraction from MR title/description, REST API fetch, ADF description parsing, acceptance-criteria custom-field support, graceful degradation when Jira is unavailable
- `GITLAB_CA_FILE` TLS/custom-CA support: `buildGitEnv()` injects `GIT_SSL_CAINFO` into git spawns; `NODE_EXTRA_CA_CERTS` set at startup for the API client; deployment matrix and setup examples in GETTING_STARTED.md
- BullMQ+Valkey task queue: `QUEUE_ENABLED` flag gates inline vs queued dispatch; `src/queue/` and `src/worker.ts`; docker-compose `worker` + `valkey` services
- Kubernetes manifests: full k8s YAMLs for namespace, configmap, secret, webhook deployment, worker deployment, service, and dev Valkey
- Multi-provider LLM fallback: `LLM_PROVIDER_ORDER` env var; Bedrock, OpenAI, and Google Gemini adapters in `src/agents/providers/`; `tryProvidersInOrder()` in `src/agents/provider-fallback.ts`
- Review checkpoint ledger: summary notes now embed machine-readable `code-smith:review-run` markers with validated status, trigger mode, reviewed SHA range, MR version id, and timestamp metadata
- Incremental review scope: automatic runs now compute `full`, `incremental`, or `skip` mode from GitLab commit history and use repository-compare diffs for unreviewed ranges while preserving current MR diff refs for inline publishing
- Version-aware publication semantics: automatic same-head reruns are skipped before publication, manual reruns always post a visible summary, and inline duplicate suppression now keys on trigger mode plus discussion `headSha`
- Repo freshness and delivery hardening: same-branch runs are serialized across the full pipeline, cached clones verify local HEAD against GitLab before review, active cache mtimes are refreshed after clone/update, metadata-only MR updates are ignored, and automatic draft reviews are configurable with `REVIEW_DRAFT_MRS`
- Repo review config foundation: `.codesmith.yaml` / `.codesmith.yml` discovery, strict Zod schema validation, safe default fallback behavior, and glob-matching helpers are implemented under `src/config/`; config-driven pipeline behavior remains future CP1 work
- Repo review config guide: repo authors now have a dedicated guide for `.codesmith.yaml` structure, examples, standards, and troubleshooting under `docs/guides/REPO_REVIEW_CONFIG.md`

Planned next:

- CodeSmith trigger and personality awakening for note-triggered reviews
- Crown Plan: finish CP1 beyond the implemented schema/loader foundation (`.codesmith.yaml` pipeline integration, prompt injection, docs/examples), then deliver linter/SAST integration, organizational learning, enhanced review output, analytics & observability, production hardening, and the threshold-driven CP7 migration path from SQLite to PostgreSQL/pgvector

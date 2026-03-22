# GitGandalf Documentation

## 🤖 Agent Documentation (`docs/agents/`)

Concise, token-optimized reference for LLM agents. Prefer these over human docs to minimize context window usage.

- [Architecture](./agents/context/ARCHITECTURE.md) — Current runtime surface, webhook flow, repo manager, tool system, internal protocol boundary, and implemented publishing behavior
- [Configuration](./agents/context/CONFIGURATION.md) — Environment variables, defaults, required fields, and test-env notes
- [Workflows](./agents/context/WORKFLOWS.md) — Implemented webhook flow, repo cache workflow, tool execution, full review workflow, and logging/observability behavior
- [Tech Stack Design](./agents/designs/tech-stack-evaluation.md) — Stack decisions and rationale summary

## 👥 Human Documentation (`docs/humans/`)

Detailed, visual documentation with Mermaid diagrams and full rationale.

- [Architecture](./humans/context/ARCHITECTURE.md) — Current implemented architecture, internal protocol boundary, operational behavior, planned phases, and ELI5 explanation
- [Multi-Agent Architecture](./humans/designs/multi-agent-architecture.md) — Agent pipeline diagram, per-agent inputs/outputs, data flow, known issues (duplicate findings, overlapping line ranges), and proposed improvements
- [Tech Stack Design](./humans/designs/tech-stack-evaluation.md) — Complete ecosystem analysis and technology decisions

## 📚 Guides (`docs/guides/`)

- [Getting Started](./guides/GETTING_STARTED.md) — Local setup, env configuration, GitLab token/webhook secret creation, webhook reachability, Jira prep, queue and provider fallback setup, KinD bootstrap, health check, and sample webhook flow
- [Development](./guides/DEVELOPMENT.md) — Bun commands, KinD helper scripts, testing strategy, logging conventions, plan-driven workflow, and tool-module conventions

## 📋 Implementation Plans (`docs/plans/`)

- **Active**: [GitGandalf Master Plan](./plans/active/git-gandalf-master-plan.md) — Phases 1–5 complete (Phase 5.5 DEFERRED), with Jira write actions deferred to Phase 6
- **Active**: [Gandalf Awakening Personality Plan](./plans/active/Gandalf-awakening-personality-plan.md) — Trigger alias expansion, Gandalf-mode acknowledgements, and tone-aware top-level summary behavior
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
| **Logging** | ✅ Complete | LogTape structured logging, `LOG_LEVEL` wired, `@logtape/hono` middleware, request correlation via `withContext()`, debug log file at `logs/gg-dev.log` |
| **Phase 5** | ✅ Complete | BullMQ+Valkey task queue with retries, timeout boundary, dead-letter handling, Kubernetes manifests, and multi-provider LLM fallback (OpenAI/Google) |

## Current State Summary

Implemented today:

- webhook ingestion and filtering
- required-field Zod payload validation with permissive GitLab key handling
- GitLab data access wrapper
- repo cache manager with host validation
- modular tool surface for investigator agents
- internal agent and tool protocol owned by GitGandalf
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
- Review checkpoint ledger: summary notes now embed machine-readable `git-gandalf:review-run` markers with validated status, trigger mode, reviewed SHA range, MR version id, and timestamp metadata
- Incremental review scope: automatic runs now compute `full`, `incremental`, or `skip` mode from GitLab commit history and use repository-compare diffs for unreviewed ranges while preserving current MR diff refs for inline publishing
- Version-aware publication semantics: automatic same-head reruns are skipped before publication, manual reruns always post a visible summary, and inline duplicate suppression now keys on trigger mode plus discussion `headSha`
- Repo freshness and delivery hardening: same-branch runs are serialized across the full pipeline, cached clones verify local HEAD against GitLab before review, active cache mtimes are refreshed after clone/update, metadata-only MR updates are ignored, and automatic draft reviews are configurable with `REVIEW_DRAFT_MRS`

Planned next:

- Gandalf trigger and personality awakening for note-triggered reviews

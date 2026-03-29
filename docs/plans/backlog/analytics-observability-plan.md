---
title: "CP5 — Analytics & Observability"
status: backlog
priority: medium
estimated_hours: 30-45
dependencies:
  - docs/plans/backlog/organizational-learning-plan.md
  - docs/plans/backlog/production-hardening-plan.md
created: 2026-03-21
date_updated: 2026-03-22

related_files:
  - src/index.ts
  - src/api/router.ts
  - src/api/pipeline.ts
  - src/config.ts
  - src/agents/llm-client.ts
  - src/publisher/gitlab-publisher.ts
  - src/analytics/store.ts
  - src/analytics/sqlite-store.ts
  - docs/context/ARCHITECTURE.md
  - docs/context/CONFIGURATION.md
  - docs/context/WORKFLOWS.md
  - docs/README.md

tags:
  - analytics
  - observability
  - metrics
  - prometheus
  - crown-plan
  - CP5

completion:
  - "# Phase A1 — Prometheus Metrics Foundation"
  - [ ] A1.0 Bun compatibility spike for prom-client (Counter, Histogram, Gauge, collectDefaultMetrics)
  - [ ] A1.1 Add prom-client dependency and create metrics registry
  - [ ] A1.2 Define core operational metrics (counters, histograms, gauges)
  - [ ] A1.3 Instrument pipeline with timing and status metrics
  - [ ] A1.4 Instrument LLM client with per-provider metrics
  - [ ] A1.5 Create /metrics endpoint on Hono router
  - [ ] A1.6 Unit tests for metric recording and endpoint output
  - [ ] A1.7 Update CONFIGURATION.md and ARCHITECTURE.md
  - "# Phase A2 — Review Analytics Storage"
  - [ ] A2.1 Extend learning database with analytics tables (or reuse review_runs)
  - [ ] A2.2 Record review metadata at pipeline completion (findings, verdict, timing, provider)
  - [ ] A2.3 Record per-finding publication status (posted, skipped, deduplicated)
  - [ ] A2.4 Add retention and cleanup for analytics data
  - [ ] A2.5 Unit tests for analytics recording and retention
  - [ ] A2.6 Update WORKFLOWS.md
  - "# Phase A3 — Analytics API Endpoints"
  - [ ] A3.1 Create GET /api/v1/admin/analytics/summary (global review stats)
  - [ ] A3.2 Create GET /api/v1/admin/analytics/projects/:id (per-project stats)
  - [ ] A3.3 Create GET /api/v1/admin/analytics/trends (time-series aggregates)
  - [ ] A3.4 Create GET /api/v1/admin/analytics/findings (finding category breakdown)
  - [ ] A3.5 Zod-validate all query parameters and responses
  - [ ] A3.6 Unit tests for all analytics endpoints
  - [ ] A3.7 Update ARCHITECTURE.md
  - "# Phase A4 — Docs & Audit"
  - [ ] A4.1 Create analytics and monitoring documentation
  - [ ] A4.2 Add Grafana dashboard JSON template for Prometheus metrics
  - [ ] A4.3 Update GETTING_STARTED.md with monitoring setup
  - [ ] A4.4 Update docs/README.md
  - [ ] A4.5 Run review-plan-phase audit
---

# CP5 — Analytics & Observability

## Executive Summary

CodeRabbit provides a built-in analytics dashboard showing review trends, finding rates, and team metrics. GitLab Duo offers SDLC trends dashboards. Code Smith currently has structured JSON logs — useful for debugging but offering zero analytics or operational monitoring.

This plan adds two layers of observability:

1. **Operational metrics** (Prometheus) — request latency, queue depth, LLM call duration, error rates. For SRE teams with existing Grafana stacks.
2. **Review analytics** (relational store + REST API, starting with SQLite) — finding trends, severity distributions, per-project stats, false positive rates, review quality scores. For engineering leadership visibility.

CP5 owns the Prometheus metrics foundation itself: the metrics registry, metric definitions, instrumentation, and `/metrics` endpoint. CP6 consumes that foundation for deployment wiring, scrape configuration, runbooks, and autoscaling follow-on work. The review analytics database reuses the schema from CP3 (Organizational Learning) `review_runs` table and follows the same singleton ops ownership model for writes.

Phase-one analytics storage uses `bun:sqlite` behind store interfaces, not as a permanent architectural commitment. CP7 is the explicit future path if Code Smith later needs PostgreSQL-backed HA, external SQL/reporting consumers, or semantic retrieval with `pgvector`.

## Technology Decisions

| Concern | Choice | Rationale |
|---|---|---|
| Operational metrics | `prom-client` (Prometheus client for Node.js/Bun) | Lightweight, battle-tested, Bun-compatible, exports text format for Prometheus scraping |
| Metrics endpoint | `/metrics` on existing Hono server | Standard Prometheus convention; no separate metrics port needed |
| Analytics storage | `bun:sqlite` via singleton ops ownership | Zero extra deps while avoiding multi-writer contention across replicated pods |
| Phase-one deployment constraint | Singleton ops pod with block-backed `ReadWriteOnce` storage only | Avoid unsafe shared-filesystem SQLite semantics in Kubernetes |
| Analytics write transport | BullMQ jobs consumed by the ops service | Reuses the existing queue stack, gives durable buffering, and keeps SQLite write access isolated |
| Analytics API | Hono routes under `/api/v1/admin/analytics/` | Keeps operator surfaces behind dedicated admin auth rather than exposing them like the webhook endpoint |
| Default metrics | Explicit app metrics first, Bun-validated default metrics second | Avoid relying on Node-default collectors until compatibility is verified under Bun |
| Dashboard | Grafana JSON template (no built-in UI) | Grafana is already the industry standard; building a UI is scope creep |
| Storage abstraction | Domain analytics/query interfaces over DB-specific code | Makes CP7 migration additive and keeps HTTP/queue contracts stable |

**Plan boundary note:** CP5 owns `src/metrics/*`, instrumentation call sites, and the `/metrics` route. CP6 owns Helm/Prometheus scrape integration, operational docs, and scaling features that consume those metrics.

**Storage boundary note:** The relational store is the source of truth for analytics facts and aggregates. Valkey remains queue and cache infrastructure only. Dedicated vector search is out of scope for CP5 unless CP7 activates semantic retrieval work later.

## Metrics Inventory

### Operational Metrics (Prometheus)

| Metric Name | Type | Labels | Description |
|---|---|---|---|
| `codesmith_reviews_total` | Counter | `trigger`, `verdict`, `range_mode` | Total review runs |
| `codesmith_review_duration_seconds` | Histogram | `trigger`, `verdict` | End-to-end review duration |
| `codesmith_llm_calls_total` | Counter | `provider`, `agent`, `status` | LLM API calls |
| `codesmith_llm_call_duration_seconds` | Histogram | `provider`, `agent` | Per-call LLM latency |
| `codesmith_llm_tokens_total` | Counter | `provider`, `agent`, `direction` | Token usage (input/output) |
| `codesmith_findings_total` | Counter | `severity`, `type` | Findings generated |
| `codesmith_publications_total` | Counter | `type`, `status` | Inline/summary publications |
| `codesmith_linter_duration_seconds` | Histogram | `linter` | Linter execution time |
| `codesmith_linter_findings_total` | Counter | `linter`, `severity` | Linter findings |
| `codesmith_webhook_requests_total` | Counter | `status`, `event_type` | Webhook requests received |
| `codesmith_queue_depth` | Gauge | — | Current queue size (when queue enabled) |
| `codesmith_feedback_events_total` | Counter | `signal_type` | Learning feedback events |

### Analytics Queries (REST API)

| Endpoint | Description | Example Response |
|---|---|---|
| `GET /admin/analytics/summary` | Global stats (last 30 days) | `{ total_reviews, avg_findings, approval_rate, avg_duration_ms }` |
| `GET /admin/analytics/projects/:id` | Per-project stats | `{ project_id, reviews, findings_by_severity, top_finding_categories }` |
| `GET /admin/analytics/trends?period=weekly` | Time-series aggregates | `[{ period, reviews, findings, approval_rate }]` |
| `GET /admin/analytics/findings?project_id=N` | Finding category breakdown | `{ categories: [{ name, count, avg_severity }] }` |

## Phased Implementation

### Phase A1 — Prometheus Metrics Foundation

**Goal:** Instrument the pipeline with Prometheus metrics and expose a scrape endpoint.

**A1.0** — **Bun compatibility spike** _(must complete before A1.1)_:
- Install `prom-client` in a throwaway branch and write a minimal test script (`scripts/prom-client-bun-spike.ts`)
- Verify: register a `Counter`, `Histogram`, and `Gauge`; call `registry.metrics()` and confirm valid Prometheus exposition format
- Test `collectDefaultMetrics()` under Bun — document which default collectors work (expected gaps: `perf_hooks` event-loop lag, `/proc/self/fd` file descriptor count, `process.cpuUsage()` results)
- **Decision gate**: if Counter/Histogram/Gauge work and `registry.metrics()` emits valid output, proceed with `prom-client`. If core metric types fail, evaluate a minimal hand-rolled registry (Counter/Histogram/Gauge → exposition string) as a fallback. Document the decision in a `docs/designs/prom-client-bun-compat.md` ADR.

**A1.1** — Add `prom-client` to dependencies:
- `bun add prom-client`
- Create `src/metrics/registry.ts`:
  - Export default `Registry` instance
  - Register explicit Code Smith application metrics first
  - Gate `collectDefaultMetrics()` behind a Bun compatibility check and tests before enabling it by default
  - Disable any default metrics that failed during the A1.0 spike

**A1.2** — Create `src/metrics/review-metrics.ts`:
- Define all counters, histograms, and gauges from the metrics inventory
- Export named metric instances
- Use reasonable histogram buckets:
  - Review duration: `[5, 10, 30, 60, 120, 300, 600]` seconds
  - LLM call duration: `[0.5, 1, 2, 5, 10, 30, 60]` seconds

**A1.3** — Instrument pipeline (`src/api/pipeline.ts`):
- Record `codesmith_reviews_total` at pipeline completion (success and failure)
- Record `codesmith_review_duration_seconds` with timer around pipeline
- Record `codesmith_findings_total` per verified finding
- Record `codesmith_publications_total` at publication time

**A1.4** — Instrument LLM client (`src/agents/llm-client.ts`):
- Record `codesmith_llm_calls_total` per call (label: provider, agent stage, success/failure)
- Record `codesmith_llm_call_duration_seconds` per call
- Record `codesmith_llm_tokens_total` if token counts are available from provider response

**A1.5** — Create `/metrics` endpoint:
- Add `GET /metrics` route to Hono router
- Return `registry.metrics()` with `Content-Type: text/plain; version=0.0.4`
- Exclude from access logging (like `/health`)

**A1.6** — Tests:
- Metric recording after simulated pipeline run
- Metric endpoint returns valid Prometheus text format
- Histogram bucket correctness
- Counter labels populated correctly

**A1.7** — Update CONFIGURATION.md (optional `METRICS_ENABLED` flag) and ARCHITECTURE.md.

### Phase A2 — Review Analytics Storage

**Goal:** Persist review metadata in SQLite for analytics queries.

**Phase-one storage constraint:** SQLite is supported only on the singleton ops deployment with block-backed `ReadWriteOnce` storage. Shared RWX/network-filesystem SQLite deployments are unsupported.

**Migration seam requirement:** Define DB-neutral storage interfaces here so PostgreSQL can replace the phase-one SQLite adapter later without rewriting route handlers, queue producers, or instrumentation call sites.

**A2.0** — Create analytics store contracts:
- Create `src/analytics/store.ts`
- Define repository/query interfaces for review-run writes, review-finding writes, retention, and analytics query endpoints
- Ensure queue payloads and HTTP response schemas do not expose SQLite-specific details

**A2.1** — Extend learning database (from CP3):
- If CP3 is not yet implemented, create standalone analytics DB with same pattern
- `review_runs` table already defined in CP3 schema — reuse it
- Add `review_findings` table:
  ```sql
  CREATE TABLE review_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_run_id INTEGER NOT NULL REFERENCES review_runs(id),
    file TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    risk_level TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT,
    published INTEGER NOT NULL DEFAULT 0,    -- was it posted as inline comment?
    publish_status TEXT,                      -- 'posted' | 'skipped_dedup' | 'skipped_no_anchor'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```

**A2.2** — Record review metadata:
- At pipeline completion (success or failure), enqueue an ops-owned analytics write job through BullMQ with a stable idempotency key (`projectId:mrIid:headSha:runKind`)
- Ops service consumes the job, validates the payload with Zod, and persists the record transactionally to SQLite
- Capture: project_id, mr_iid, head_sha, trigger_mode, review_range_mode, findings_count, verdict, duration_ms, llm_provider
- Implement the phase-one adapter in `src/analytics/sqlite-store.ts` behind the A2.0 interfaces

**A2.3** — Record per-finding publication status:
- After publication, include per-finding publication status in the same ops job or an adjacent idempotent child job so non-ops pods never write SQLite directly
- Track `category` derived from finding title (same categorization as CP3 feedback normalization)

**A2.4** — Retention:
- `ANALYTICS_RETENTION_DAYS` config (default: 90)
- Periodic cleanup: delete records older than retention period
- Run cleanup only in the singleton ops service scheduler, not on every pod startup

**A2.5** — Tests:
- Review run recording
- Finding recording with publication status
- Retention cleanup
- Duplicate job delivery resolves idempotently
- Query performance with moderate data volume (~10K records)
- Verify indexes and query plans cover the planned summary, project, trends, and findings endpoints

**A2.6** — Update WORKFLOWS.md.

### Phase A3 — Analytics API Endpoints

**Goal:** Expose review analytics via REST API for dashboards and reports.

**A3.1** — `GET /api/v1/admin/analytics/summary`:
- Query params: `days` (default: 30)
- Response:
  ```json
  {
    "period_days": 30,
    "total_reviews": 145,
    "total_findings": 312,
    "avg_findings_per_review": 2.15,
    "approval_rate": 0.62,
    "avg_duration_ms": 45000,
    "verdicts": { "APPROVE": 90, "REQUEST_CHANGES": 35, "NEEDS_DISCUSSION": 20 },
    "findings_by_severity": { "critical": 5, "high": 42, "medium": 180, "low": 85 }
  }
  ```

**A3.2** — `GET /api/v1/admin/analytics/projects/:id`:
- Same structure as summary but filtered to a specific project
- Additional field: `top_finding_categories` (top 5 categories by count)

**A3.3** — `GET /api/v1/admin/analytics/trends`:
- Query params: `period` (`daily` | `weekly` | `monthly`), `days` (default: 90)
- Response: array of time-bucketed aggregates
  ```json
  [
    { "period": "2026-W12", "reviews": 35, "findings": 72, "approval_rate": 0.65, "avg_duration_ms": 42000 },
    { "period": "2026-W13", "reviews": 41, "findings": 85, "approval_rate": 0.58, "avg_duration_ms": 48000 }
  ]
  ```

**A3.4** — `GET /api/v1/admin/analytics/findings`:
- Query params: `project_id` (optional), `days` (default: 30)
- Response: finding category breakdown with counts and average severity

**A3.5** — Zod-validate all query parameters and response schemas. Enforce dedicated admin auth and return 400 for invalid params.

**A3.5a** — Query budget and bounded workload rules:
- Every analytics endpoint must require a bounded date window or pagination
- Add explicit indexes that match endpoint filters and group-bys
- Prefer precomputed rollups or cached aggregates when full-history scans become expensive
- Document target latency budgets for operator endpoints so slow growth becomes visible before CP7 is forced by surprise

**A3.6** — Tests:
- All endpoints with mock data
- Query parameter validation
- Empty data scenarios
- Date range filtering

**A3.7** — Update ARCHITECTURE.md.

### Phase A4 — Docs & Audit

**Goal:** Documentation and monitoring setup guide.

**A4.1** — Create `docs/guides/MONITORING.md`:
- Prometheus metrics reference (all metrics with descriptions)
- Grafana setup instructions (Prometheus datasource + import dashboard)
- Analytics API reference (all endpoints with examples)
- Admin route-group auth and internal-ingress setup
- Alerting recommendations (what thresholds to monitor)

**A4.2** — Create `charts/grafana-dashboard.json` (or `monitoring/grafana-dashboard.json`):
- Pre-built Grafana dashboard template with panels for:
  - Review rate (reviews/hour)
  - Review duration percentiles (P50, P95, P99)
  - Finding severity distribution
  - LLM provider usage and latency
  - Queue depth (when enabled)
  - Error rate
- Importable via Grafana UI

**A4.3** — Update `docs/guides/GETTING_STARTED.md` with monitoring setup section.

**A4.4** — Update `docs/README.md`.

**A4.5** — Run `review-plan-phase` audit.

# Workflows

Operational walkthrough of the workflows implemented today and the next planned handoff points.

## 1. Webhook Ingestion

Implemented in `src/api/router.ts`.

### Accepted events

- merge request events with action `open`, `update`, or `reopen`
- note events whose body starts with `/ai-review` and whose `noteable_type` is `MergeRequest`

### Request handling

1. verify `X-Gitlab-Token`
2. parse JSON body
3. `safeParse()` against `webhookPayloadSchema`
4. filter unsupported events
5. build `ReviewTriggerContext` carrying trigger semantics into the pipeline:
   - merge request events → `mode: "automatic"`, `source: "merge_request_event"`
   - `/ai-review` note events → `mode: "manual"`, `source: "mr_note_command"`, plus `noteId` and `rawCommand`
6. for merge-request `update` events, ignore metadata-only deliveries when GitLab reports the same `oldrev` and current `last_commit.id`
7. when `REVIEW_DRAFT_MRS=false`, ignore automatic draft/WIP MR events but still allow manual `/ai-review` note commands
8. generate `requestId` via `Bun.randomUUIDv7()` and propagate via LogTape `withContext()`
9. dispatch on `QUEUE_ENABLED`:
   - `true`: add job to BullMQ `review` queue; a worker process calls `runPipeline()` asynchronously
   - `false` (default): call `runPipeline(event, trigger)` without awaiting (fire-and-forget, original behaviour)
10. return `202 Accepted`

HTTP request/response logging is handled automatically by `@logtape/hono` middleware and emits structured JSON Lines to stdout. Health check requests are excluded from logging.

### Response codes

- `401 Unauthorized`: wrong or missing secret
- `400 Invalid JSON` / `400 Invalid payload`: malformed body or failed schema validation
- `200 Ignored`: valid webhook that does not match the trigger rules
- `202 Accepted`: relevant webhook queued into the full async review pipeline

## 2. Repo Cache Workflow

Implemented in `src/context/repo-manager.ts`.

- cache location: `config.REPO_CACHE_DIR/<projectId>-<url-encoded-branch>`
- first fetch path: shallow clone
- refresh path: shallow fetch with explicit refspec + hard reset to `origin/<branch>`
- post-refresh verification: `git rev-parse HEAD` must equal the expected GitLab MR head SHA or the pipeline throws before review runs
- cache freshness touch: after clone/update, `utimes(repoPath, now, now)` bumps the directory mtime so active clones survive TTL cleanup on filesystems where git internals do not update the directory mtime consistently
- cleanup path: delete cached directories older than TTL
- retention policy: completed reviews keep the warmed clone on disk; eviction remains TTL-based rather than eager post-review deletion
- security gate: clone URL hostname must match `config.GITLAB_URL`
- TLS / custom CA: `buildGitEnv(config.GITLAB_CA_FILE)` is called inside every git subprocess spawn; when `GITLAB_CA_FILE` is set it adds `GIT_SSL_CAINFO` to the subprocess env so git trusts the configured CA bundle. `NODE_EXTRA_CA_CERTS` is set from the same value at startup (`src/index.ts`) for the `@gitbeaker/rest` API client
- clone auth: GitLab token injected as `oauth2:<token>` HTTP basic credentials in the clone URL; no SSH key setup required

## 3. Tool Execution Workflow

Implemented in `src/context/tools/index.ts` and per-tool modules.

1. LLM emits a tool-call block through the internal agent protocol
2. `executeTool()` selects the tool by name
3. tool input is validated with a Zod schema
4. implementation runs inside the repo sandbox
5. result is returned as a string or JSON string payload

If a specific tool call throws, Agent 2 catches the failure and sends the error back to the model as an error `tool_result` block instead of aborting the review.

### Current tools

- `read_file`
- `search_codebase`
- `get_directory_structure`

## 4. Full Pipeline

`src/api/pipeline.ts` is the full end-to-end pipeline: fetch MR data → load current review ledger surfaces → clone repo → fetch Jira context → run agents → publish findings.
The pipeline receives a `ReviewTriggerContext` from the router which is threaded into `ReviewState.triggerContext` and used for logging.
Automatic MR triggers now perform an early same-head guard after `getMRDetails()`: if a cached top-level CodeSmith summary note already embeds the current `headSha`, the pipeline logs the skip and returns before repo refresh or agent execution. Manual `/ai-review` triggers bypass this guard and always run.
The pipeline also caches MR discussions, top-level MR notes, and MR diff versions once per run. Top-level notes are used for summary/head-sha guards and checkpoint parsing; discussions are reused for inline duplicate detection.
Runs are serialized per `{projectId}-{branch}` across the full pipeline, starting before `getMRDetails()`. This ensures a later same-branch delivery re-reads MR state after any earlier run writes its summary/checkpoint.
All pipeline logs emit structured JSON under `["codesmith", "pipeline"]` and carry the implicit `requestId`, `projectId`, and `mrIid` context set by the router and pipeline entry.

### Checkpoint write/read flow

- Summary publication embeds a `code-smith:review-run` block inside the summary note body before the footer.
- The marker includes `format_version=1`, status, trigger mode, reviewed range start/end SHAs, MR version id, publish flags, run id, and timestamp.
- `src/publisher/checkpoint.ts` parses those markers with Zod and selects the latest successful checkpoint.
- Failed or partial runs may still write markers for auditability, but they are excluded when determining the next automatic review checkpoint.

### Incremental review flow

- Pipeline loads MR commits and MR diff versions alongside the current MR diff, discussions, and top-level notes.
- `selectReviewRange()` chooses `full`, `incremental`, or `skip` mode for automatic runs from the last successful checkpoint and the current MR commit list.
- When the checkpoint head SHA is missing from the current MR commit list, CodeSmith treats the branch as rewritten and falls back to a full current-MR review.
- When the checkpoint end SHA already equals the current head, the automatic run is skipped before repo refresh or agent execution.
- For `incremental` mode, the analysis diff comes from GitLab repository compare (`from=lastReviewedHeadSha`, `to=currentHeadSha`); publisher anchoring continues to use the current MR diff refs unchanged.
- This same-head skip, combined with per-branch serialization, keeps duplicate or out-of-order automatic webhook deliveries idempotent for the current head.

When queue mode is enabled, each worker attempt is bounded by `REVIEW_JOB_TIMEOUT_MS`. If an attempt exceeds that boundary, the worker fails the attempt, BullMQ retries according to the queue policy, and terminal failures are copied into the `review-dead-letter` queue for operator inspection.

## 4a. Jira Ticket Enrichment

Implemented in `src/integrations/jira/client.ts`. Called from `src/api/pipeline.ts` between repo clone and agent invocation.

### Key extraction

`extractTicketKeys(text, allowedProjectKeys?)` scans the MR title and description with `/\b([A-Z][A-Z0-9]+-\d+)\b/g`.

- handles the common `PROJ-NNN: title` format (e.g. `SRT-28326: refactor auth`)
- deduplicates repeated keys across title and description
- applies the `JIRA_PROJECT_KEYS` allow-list when configured
- caps the result with `JIRA_MAX_TICKETS` before fetching

### Per-ticket fetch

`fetchJiraTicket(key, config)` calls `/rest/api/3/issue/<key>` with Basic Auth (`JIRA_EMAIL:JIRA_API_TOKEN`).

- uses an `AbortController` with `JIRA_TICKET_TIMEOUT_MS` per request
- extracts `summary`, `status`, `issueType`, `priority`, `assignee`, `description`
- supports Atlassian Document Format (ADF) descriptions — plain text is extracted from paragraph nodes
- supports an optional acceptance-criteria custom field via `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID`
- Zod-validates the raw API response before normalizing; returns `null` on any failure
- never throws — all errors are logged as `warn` and degrade gracefully

### Integration with agents

`ReviewState.linkedTickets: JiraTicket[]` carries the resolved tickets into the agent pipeline.
`contextAgent()` includes a `## Linked Jira Tickets` block in its user prompt when the array is non-empty. Each ticket entry renders key, summary, status, type, optional priority, assignee, description (truncated to 400 chars), and acceptance criteria (truncated to 400 chars).

## 5. Agent Review Workflow

Implemented in `src/agents/`.

1. caller provides `ReviewState` input fields: `mrDetails`, `diffFiles`, `repoPath`, `linkedTickets`
2. `contextAgent()` derives `mrIntent`, `changeCategories`, and `riskAreas`; uses `linkedTickets` when non-empty
3. `investigatorLoop()` builds the investigation prompt and calls `chatCompletion()`, which iterates `LLM_PROVIDER_ORDER` via `tryProvidersInOrder()` — trying each provider until one succeeds or all fail
4. tool requests are executed through `executeTool()` using `TOOL_DEFINITIONS`
5. `reflectionAgent()` filters the raw findings and assigns a verdict
6. `orchestrator.ts` allows one reinvestigation round when `needsReinvestigation` is true

Current publishing behavior after review:

- inline discussions are created only for findings that can be anchored to diff positions
- non-diff findings are skipped for inline publication and summarized instead of crashing publication
- automatic same-head duplicate prevention happens in `src/api/pipeline.ts` before diff fetch, repo refresh, or agent execution; unchanged-head automatic reruns do not reach the publisher
- completed manual reruns always post a visible summary note, even when the current head was already reviewed
- inline duplicate suppression is head-aware: notes from an older `position.headSha` never suppress findings on a newer head
- manual inline duplicate suppression is narrower than automatic suppression: only same-head findings with the same marker and overlapping anchored line are skipped on manual reruns

The agent subsystem is implemented and invoked from the API pipeline.

## 6. Logging & Observability

All structured logs are emitted as JSON Lines to stdout via LogTape:

- `["codesmith", "http"]` — HTTP request/response via `@logtape/hono` middleware
- `["codesmith", "router"]` — webhook auth and validation events
- `["codesmith", "pipeline"]` — pipeline start/complete
- `["codesmith", "jira"]` — Jira fetch start, completion, and degradation warnings
- `["codesmith", "orchestrator"]` — per-agent-stage progress
- `["codesmith", "publisher"]` — inline comment posting, duplicates, errors

All log lines in the webhook → pipeline flow carry `requestId`, `projectId`, and `mrIid` automatically via LogTape implicit context.

## 7. Planned Crown Learning / Analytics Workflow

The following workflow is planned by CP3, CP5, CP6, and CP7 but is not implemented in the current repo yet:

1. webhook and worker roles emit durable BullMQ jobs for learning feedback writes, analytics writes, retention work, and pattern extraction triggers
2. a singleton ops role consumes those jobs and is the only role allowed to mutate the phase-one relational store
3. phase-one storage uses `bun:sqlite` under WAL mode, but only on block-backed `ReadWriteOnce` storage owned by the ops pod
4. worker pods read active learned patterns through a separate internal read-only service contract; they do not receive operator admin credentials and do not mount the SQLite file directly
5. admin and analytics APIs live behind a dedicated `/api/v1/admin/*` surface with separate auth from webhook ingestion
6. if activation criteria are met later, CP7 switches the relational adapters from SQLite to PostgreSQL without changing queue payloads or HTTP contracts; `pgvector` is added only if semantic retrieval is proven necessary

### Activation criteria for CP7

- HA pressure beyond a singleton writer plus queue-based buffering
- external SQL or BI/reporting consumers
- sustained queue lag caused by learning or analytics writes
- multi-GB growth with degraded bounded admin queries
- stronger backup or PITR requirements than file-copy restore
- semantic retrieval needs that heuristic learned-pattern rules cannot satisfy

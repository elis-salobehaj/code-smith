# Workflows (Agent Reference)

Operational reference for the workflows implemented today and the next planned handoff points.

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
6. generate `requestId` via `Bun.randomUUIDv7()` and propagate via LogTape `withContext()`
7. call `runPipeline(event, trigger)` without awaiting
8. return `202 Accepted`

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
- cleanup path: delete cached directories older than TTL
- security gate: clone URL host must match `config.GITLAB_URL`

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

`src/api/pipeline.ts` is the full end-to-end pipeline: fetch MR data → clone repo → fetch Jira context → run agents → publish findings.
The pipeline receives a `ReviewTriggerContext` from the router which is threaded into `ReviewState.triggerContext` and used for logging. Future phases will use the trigger mode to branch automatic vs manual behavior (checkpoint skipping, publication policy).
Automatic MR triggers now perform an early same-head guard after `getMRDetails()`: if an existing GitGandalf summary note already embeds the current `headSha`, the pipeline logs the skip and returns before fetching diffs, cloning the repo, or invoking agents. Manual `/ai-review` triggers bypass this guard and always run.
All pipeline logs emit structured JSON under `["gandalf", "pipeline"]` and carry the implicit `requestId`, `projectId`, and `mrIid` context set by the router and pipeline entry.

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
3. `investigatorLoop()` builds the investigation prompt and calls Bedrock Runtime Converse through the internal protocol adapter
4. tool requests are executed through `executeTool()` using `TOOL_DEFINITIONS`
5. `reflectionAgent()` filters the raw findings and assigns a verdict
6. `orchestrator.ts` allows one reinvestigation round when `needsReinvestigation` is true

Current publishing behavior after review:

- inline discussions are created only for findings that can be anchored to diff positions
- non-diff findings are skipped for inline publication and summarized instead of crashing publication
- summary notes are always posted for completed review runs; automatic same-head duplicate prevention now happens earlier in `src/api/pipeline.ts`, before diff fetch, repo refresh, or agent execution

The agent subsystem is implemented and invoked from the API pipeline.

## 6. Logging & Observability

All structured logs are emitted as JSON Lines to stdout via LogTape:

- `["gandalf", "http"]` — HTTP request/response via `@logtape/hono` middleware
- `["gandalf", "router"]` — webhook auth and validation events
- `["gandalf", "pipeline"]` — pipeline start/complete
- `["gandalf", "jira"]` — Jira fetch start, completion, and degradation warnings
- `["gandalf", "orchestrator"]` — per-agent-stage progress
- `["gandalf", "publisher"]` — inline comment posting, duplicates, errors

All log lines in the webhook → pipeline flow carry `requestId`, `projectId`, and `mrIid` automatically via LogTape implicit context.

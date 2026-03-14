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
5. call `runPipeline(event)` without awaiting
6. return `202 Accepted`

### Response codes

- `401 Unauthorized`: wrong or missing secret
- `400 Invalid JSON` / `400 Invalid payload`: malformed body or failed schema validation
- `200 Ignored`: valid webhook that does not match the trigger rules
- `202 Accepted`: relevant webhook queued into the stub pipeline

## 2. Repo Cache Workflow

Implemented in `src/context/repo-manager.ts`.

- cache location: `config.REPO_CACHE_DIR/<projectId>`
- first fetch path: shallow clone
- refresh path: shallow fetch + hard reset to `origin/<branch>`
- cleanup path: delete cached directories older than TTL
- security gate: clone URL host must match `config.GITLAB_URL`

## 3. Tool Execution Workflow

Implemented in `src/context/tools/index.ts` and per-tool modules.

1. LLM emits `tool_use` block
2. `executeTool()` selects the tool by name
3. tool input is validated with a Zod schema
4. implementation runs inside the repo sandbox
5. result is returned as a string or JSON string payload

### Current tools

- `read_file`
- `search_codebase`
- `get_directory_structure`

## 4. Current Pipeline Boundary

`src/api/pipeline.ts` is still a stub. The current workflow ends at logging:

- accepted event kind
- project id

No repo clone, Bedrock call, or GitLab publishing occurs yet.

## 5. Planned Handoff to Phase 3 and 4

- Phase 3 will consume `RepoManager` and `src/context/tools` from the investigator agent loop
- Phase 4 will replace the pipeline stub with: fetch MR data → clone repo → run orchestrator → publish comments

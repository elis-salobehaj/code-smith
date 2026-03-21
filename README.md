# GitGandalf

GitGandalf is a self-hosted GitLab merge request review service. It accepts MR and `/ai-review` webhooks, clones the target repository into a local cache, runs a three-agent review pipeline against the diff and repository context, and publishes verified findings back to GitLab.

The current implementation is live end to end:

- webhook ingestion and filtering
- typed GitLab API access
- shallow repo caching with host validation
- modular repository tools for Agent 2
- internal GitGandalf agent protocol
- AWS Bedrock Runtime Converse adapter
- inline discussion and summary-note publishing
- structured JSON logging with request correlation

## Review Flow

```text
GitLab webhook -> router validation -> pipeline -> Jira enrichment -> agents -> GitLab comments
```

1. GitLab sends a `merge_request` event or a `note` event beginning with `/ai-review`.
2. The router verifies `X-Gitlab-Token`, validates the required webhook fields with Zod, and returns `202 Accepted` immediately for supported events.
3. The pipeline fetches MR metadata and diffs, then clones or updates the source branch in the repo cache.
4. The pipeline extracts Jira ticket keys from the MR title and description (e.g. `SRT-28326:` prefix), fetches those tickets from the Jira REST API, and attaches them to the review state. This step degrades safely when Jira is disabled or unavailable.
5. Agent 1 maps intent and risk areas, incorporating linked Jira ticket context when present.
6. Agent 2 investigates with `read_file`, `search_codebase`, and `get_directory_structure`.
7. Agent 3 filters weak findings, decides the verdict, and hands verified findings to the publisher.
8. The publisher creates inline discussions when a finding can be anchored to the diff and always posts a summary note.

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- [Git](https://git-scm.com/)
- [ripgrep](https://github.com/BurntSushi/ripgrep) for repository search tools
- [Docker](https://docs.docker.com/get-docker/) with Compose plugin for containerized deployment
- GitLab access with a token that has `api` scope
- AWS Bedrock access for Claude Sonnet 4 through the Bedrock Runtime Converse API

## Configuration

Copy `.env.example` to `.env` and set the required values.

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `GITLAB_URL` | Base URL of the GitLab instance, for example `https://gitlab.example.com` |
| `GITLAB_TOKEN` | GitLab token used for API calls and authenticated clone/fetch operations |
| `GITLAB_WEBHOOK_SECRET` | Shared secret checked against `X-Gitlab-Token` |
| `AWS_REGION` | AWS region used by the Bedrock Runtime client |
| `AWS_BEARER_TOKEN_BEDROCK` | Bearer token for Bedrock Runtime auth |
| `AWS_AUTH_SCHEME_PREFERENCE` | Keep this quoted as `'smithy.api#httpBearerAuth'` in dotenv files |
| `LLM_MODEL` | Bedrock model ID passed to Converse |
| `MAX_TOOL_ITERATIONS` | Maximum Agent 2 tool-call rounds |
| `MAX_SEARCH_RESULTS` | Maximum `search_codebase` hits returned to the model |
| `REPO_CACHE_DIR` | Root directory for shallow repo clones |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` |
| `PORT` | HTTP port, default `8020` |
| `JIRA_ENABLED` | Set to `true` to activate Jira ticket enrichment. Default `false` |
| `JIRA_BASE_URL` | Jira Cloud base URL, for example `https://your-company.atlassian.net` |
| `JIRA_EMAIL` | Email associated with the Jira API token |
| `JIRA_API_TOKEN` | Atlassian API token (generate at `https://id.atlassian.com/manage-profile/security/api-tokens`). Must be a single unbroken line in `.env` |
| `JIRA_PROJECT_KEYS` | Optional comma-separated allow-list of project keys, e.g. `SRT,ENG`. When unset, all extracted keys are fetched |
| `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID` | Optional custom-field ID for acceptance-criteria content, e.g. `customfield_12345` |
| `JIRA_MAX_TICKETS` | Maximum tickets fetched per review run. Default `5` |
| `JIRA_TICKET_TIMEOUT_MS` | Per-ticket HTTP fetch timeout in milliseconds. Default `5000` |

## Local Run

```bash
bun install
bun run dev
```

The app listens on `http://localhost:8020` by default.

Health check:

```bash
curl http://127.0.0.1:8020/api/v1/health
```

## Webhook Setup

For project-level setup:

1. Go to GitLab -> Settings -> Webhooks.
2. Set the URL to `http://<reachable-host>:8020/api/v1/webhooks/gitlab`.
3. Set the secret token to `GITLAB_WEBHOOK_SECRET`.
4. Enable merge request events.
5. Enable note/comment events if you want `/ai-review` manual triggers.

For self-managed instance-wide automatic coverage, a system hook is valid for merge request events, but `/ai-review` note triggers still require project-level or group-level note events.

If GitLab cannot reach your workstation directly, use an SSH reverse tunnel for early testing:

```bash
ssh -N -R 127.0.0.1:8020:localhost:8020 gitlab-user@gitlab.example.com
```

Use `ssh -R`, not `ssh -L`, when the goal is to expose your local GitGandalf process to the remote side.

## Runtime Notes

- Webhook schemas are permissive about extra GitLab keys but strict about the fields GitGandalf actually uses.
- Bedrock-specific message translation is isolated in `src/agents/llm-client.ts`.
- Individual Agent 2 tool failures are returned to the model as error `tool_result` blocks instead of crashing the whole review.
- Findings that cannot be anchored to the diff are skipped for inline publication and preserved in the summary verdict flow.
- When `LOG_LEVEL=debug`, logs are also written to `logs/gg-dev.log`.
- Jira ticket keys are extracted from the MR title and description using the pattern `[A-Z][A-Z0-9]+-\d+`. MR titles that begin with a ticket key followed by a colon (e.g. `SRT-28326: refactor auth layer`) are automatically detected. All Jira errors are logged as warnings and never abort a review.
- `JIRA_API_TOKEN` must be pasted as a single unbroken line in `.env`. A token split across lines will be read as two separate values and authentication will fail with `401`.
- When `JIRA_ENABLED=false` (the default), no Jira calls are made and `linkedTickets` is always an empty array.

## Development Commands

```bash
bun test
bun run typecheck
bun run check
bun run ci
```

## Documentation

- Main documentation index: [docs/README.md](docs/README.md)
- Human architecture guide: [docs/humans/context/ARCHITECTURE.md](docs/humans/context/ARCHITECTURE.md)
- Agent architecture reference: [docs/agents/context/ARCHITECTURE.md](docs/agents/context/ARCHITECTURE.md)
- Setup guide: [docs/guides/GETTING_STARTED.md](docs/guides/GETTING_STARTED.md)
- Development workflow guide: [docs/guides/DEVELOPMENT.md](docs/guides/DEVELOPMENT.md)

## License

Apache 2.0 - see [LICENSE](LICENSE).

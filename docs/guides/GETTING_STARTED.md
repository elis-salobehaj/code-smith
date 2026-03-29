# Getting Started

This guide gets the current implemented CodeSmith runtime running locally.

## Prerequisites

- Bun
- Git
- ripgrep (`rg`) for the context tools
- a GitLab token and webhook secret
- Bedrock bearer token values for the AWS Bedrock Runtime Converse client used by the agent pipeline

## 1. Install dependencies

```bash
bun install
```

## 2. Create your local environment file

Start from `.env.example` and provide real values.

Required values today:

- `GITLAB_URL`
- `GITLAB_TOKEN`
- `GITLAB_WEBHOOK_SECRET`
- `AWS_BEARER_TOKEN_BEDROCK`

Important:

- keep `AWS_AUTH_SCHEME_PREFERENCE='smithy.api#httpBearerAuth'` quoted
- the implemented LLM path uses the AWS SDK Bedrock Runtime Converse API with bearer-token auth
- `MAX_SEARCH_RESULTS` controls the cap used by `search_codebase`
- `REPO_CACHE_DIR` is where shallow clones will be cached
- `GITLAB_URL` must be the GitLab base URL, for example `https://gitlab.example.com`, not the webhook settings page URL

If you want to author repo-owned review config, see [`docs/guides/REPO_REVIEW_CONFIG.md`](./REPO_REVIEW_CONFIG.md). That guide explains what `.codesmith.yaml` is, how to structure it, and which parts of the contract are already active versus still planned.

## 3. Configure repo-level review rules

Repo-owned review configuration is already live. CodeSmith looks for `.codesmith.yaml`
or `.codesmith.yml` at the repository root after cloning the target repo.

This repository now ships a dogfooding example at [`/.codesmith.yaml`](../../.codesmith.yaml).
It demonstrates the current recommended baseline:

- repo-level `review_instructions` for CodeSmith's Bun, Zod, and security conventions
- file-specific guidance for `src/agents/**`, `src/config/**`, `tests/**`, and `docs/**`
- exclusion of `node_modules/**`, `dist/**`, `logs/**`, and common lockfiles
- severity defaults that keep low findings visible while reserving `REQUEST_CHANGES` for `high` and above

For your own repositories:

1. Add `.codesmith.yaml` at the repo root.
2. Start with `version: 1` and only the fields you actually need.
3. Use `exclude` for generated, vendored, build, or snapshot output.
4. Add short `review_instructions` and `file_rules[].instructions` that explain what correctness means in your codebase.
5. Keep guidance specific and factual rather than trying to script the reviewer.

See [`docs/guides/REPO_REVIEW_CONFIG.md`](./REPO_REVIEW_CONFIG.md) for the full field reference and more examples.

## GitLab personal access token (GLPAT)

This service uses `GITLAB_TOKEN` in two places:

- GitLab API calls to read MR data and publish review comments
- HTTPS git clone/fetch operations in the repo cache manager

Create a token with a dedicated bot or service account when possible.

For GitLab.com or self-hosted GitLab:

1. Open GitLab and go to your avatar → Preferences or Edit profile → Access tokens.
2. Create a personal access token named something like `code-smith-local-dev`.
3. Set an expiry date that matches your local-security requirements.
4. Grant the `api` scope.

`api` is the minimum practical scope for the current implementation because it covers:

- merge request reads
- discussion and note creation
- authenticated HTTPS repository access for clone/fetch

After creating the token, set it as `GITLAB_TOKEN` in `.env`.

## GitLab webhook secret

`GITLAB_WEBHOOK_SECRET` is just a shared secret string between GitLab and this service.
It does not come from GitLab automatically; you generate it yourself.

One simple way to create it locally:

```bash
openssl rand -hex 32
```

Then:

1. Put that value in `.env` as `GITLAB_WEBHOOK_SECRET`.
2. In GitLab, open the target project.
3. Go to Settings → Webhooks.
4. Set the webhook URL to your CodeSmith endpoint.
5. Paste the same secret into the webhook secret/token field.
6. Subscribe to merge request events and, if you want `/ai-review`, note events.

The exact field label varies slightly by GitLab version, but the value must match the
`X-Gitlab-Token` header GitLab sends.

## Project webhook vs system hook

If your goal is to have CodeSmith review merge requests across the entire GitLab instance,
a system hook is a valid approach on self-hosted GitLab when you have administrator access.

What works well with a system hook today:

- one admin-level webhook instead of configuring each project separately
- merge request events across the whole instance
- the same shared-secret validation using `X-Gitlab-Token`

Important limits:

- system hooks are an administrator feature for GitLab Self-Managed and GitLab Dedicated, not the general GitLab.com path
- the current runtime is built around merge request and note events; a system hook covers merge request review triggers, but `/ai-review` note-triggered reviews still need a project-level or group-level webhook path
- if you need both automatic MR reviews and manual `/ai-review` comment triggers, project or group webhooks are the baseline configuration since system hooks do not deliver note events

### Option A: project webhook

Use this when:

- you want the most portable setup
- you need `/ai-review` note events today
- you are running on GitLab.com or do not have instance-admin access

Setup:

1. Open the target project.
2. Go to Settings → Webhooks.
3. Set the webhook URL to your CodeSmith endpoint.
4. Paste `GITLAB_WEBHOOK_SECRET` into the secret/token field.
5. Subscribe to merge request events and, if you want `/ai-review`, note events.

### Option B: system hook

Use this when:

- you run GitLab Self-Managed
- you have administrator access
- you want automatic MR review coverage across all projects on the instance

Setup:

1. In GitLab, open Admin.
2. Go to System hooks.
3. Add a new webhook pointing at your CodeSmith endpoint.
4. Paste the same `GITLAB_WEBHOOK_SECRET` into the secret token field.
5. Enable at least merge request events.

If you want fully instance-wide automatic reviews, this is the simplest operational model.
If you also want manual `/ai-review` triggers from MR comments, keep a project or group webhook
for note events as well.

## Webhook reachability

GitLab must be able to make an HTTP request to the CodeSmith webhook URL.

What this means in practice:

- if GitLab and CodeSmith run on the same machine, `http://localhost:8020` can work
- if GitLab runs on a different machine, `localhost` on your laptop is not reachable from GitLab
- a reverse proxy is only useful if GitLab can already reach the proxy and the proxy can route traffic to your CodeSmith process

Common setups:

1. Run CodeSmith on a host GitLab can reach directly, then use `http://that-host:8020/api/v1/webhooks/gitlab` or an HTTPS URL in front of it.
2. For early testing, create an SSH reverse tunnel from your machine to a host GitLab can reach.
3. For longer-lived environments, run CodeSmith on a reachable host directly.

For early testing, the simplest terminal-only option is usually an SSH reverse tunnel.
The important detail is direction:


- `ssh -L` exposes a remote service to your local machine
- `ssh -R` exposes your local service on the remote machine

For GitLab to reach a service running on your laptop, you usually want `ssh -R`, not `ssh -L`.

Example when you can SSH to the GitLab host itself:

```bash
ssh -v -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -R 127.0.0.1:8020:localhost:8020 \
  gitlab-user@gitlab.example.com
```

Then point the webhook URL at:

```text
http://127.0.0.1:8020/api/v1/webhooks/gitlab
```

That works for short-lived self-hosted testing when the GitLab server is allowed to send webhook requests to its own localhost.

If you need GitLab to hit a different reachable host instead of its own localhost, use a bastion or utility host:

```bash
ssh -N -R 0.0.0.0:8020:localhost:8020 user@reachable-host
```

Then configure the webhook URL to use that host, for example:

```text
http://reachable-host:8020/api/v1/webhooks/gitlab
```

Notes:

- binding `0.0.0.0` on the remote side may require `GatewayPorts yes` or `GatewayPorts clientspecified` on the remote SSH server
- `ssh -N` keeps the tunnel open without starting a shell
- this is appropriate for early testing, not a durable production ingress design

For self-hosted GitLab system hooks, remember one more constraint: the GitLab instance itself must be allowed to send requests to that destination. If CodeSmith is only listening on your local machine, GitLab will need either a network route to it or a tunnel/proxy endpoint that is reachable from the GitLab server.

## Jira setup

Jira ticket fetching is live and optional. When enabled, CodeSmith reads ticket keys from the MR title and description, fetches each ticket from the Jira REST API, and passes the context to Agent 1 before the review begins. This step always degrades gracefully — if Jira is unavailable or a ticket cannot be fetched, the review continues without ticket context.

The integration is **disabled by default** (`JIRA_ENABLED=false`). Existing deployments are unaffected until you opt in.
### Jira API token

CodeSmith uses Jira Cloud's REST API v3 with Basic Auth. The credential is `email:api_token`, base64-encoded in each request header.

To create a token:

1. Log in to your Atlassian account (even if your org uses SSO via Okta, Azure AD, or similar, you can still generate API tokens from the Atlassian account portal).
2. Go to **https://id.atlassian.com/manage-profile/security/api-tokens** (not the Jira project settings — this is the Atlassian account-level page).
3. Click **Create API token**, give it a label (e.g. `code-smith`), and copy the value immediately — it is not shown again.
4. Set `JIRA_EMAIL` to the email address on that Atlassian account and `JIRA_API_TOKEN` to the copied token.

**Critical:** paste `JIRA_API_TOKEN` as a **single unbroken line** in `.env`. A line break anywhere in the token value causes it to be read as two separate variables and Jira will return `401 Client must be authenticated`.

**SSO note:** if your organization enforces SAML SSO via Atlassian Access and has additionally restricted API token usage, API tokens may not work for accounts governed by that policy. In that case, ask an Atlassian administrator to either exempt a service account from the restriction or create a dedicated non-SSO Jira account for CodeSmith.

### Recommended: read-only service account

For production use, create a dedicated Jira account (e.g. `code-smith-bot@your-company.com`) and grant it only **Browse Projects** permission on the relevant Jira project permission scheme. Generate the API token for that account. This limits blast radius: if the token is ever compromised, it cannot write to Jira or access projects it has not been explicitly granted.

### Environment variables

```env
JIRA_ENABLED=true
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=code-smith-bot@your-company.com
JIRA_API_TOKEN=<paste full token on one line>
# Optional: restrict lookups to specific project keys
JIRA_PROJECT_KEYS=SRT,ENG
# Optional: custom field ID for acceptance criteria
# JIRA_ACCEPTANCE_CRITERIA_FIELD_ID=customfield_12345
```

### How it works at runtime

Once enabled, the pipeline extracts ticket keys from the MR title and description using the pattern `[A-Z][A-Z0-9]+-\d+`. The most common pattern in practice is a title that begins with the ticket key followed by a colon — for example `SRT-28326: refactor authentication layer`. CodeSmith handles this automatically; you do not need to configure any title format.

Keys found in both the title and description are deduplicated. The `JIRA_PROJECT_KEYS` allow-list filters out keys from projects you do not want CodeSmith to look up. `JIRA_MAX_TICKETS` (default 5) caps the number of API calls per review run.

Resolved tickets are attached to `ReviewState.linkedTickets` and included in Agent 1's prompt as a `## Linked Jira Tickets` section with the ticket's summary, status, issue type, priority, assignee, description, and acceptance criteria. All logs from the Jira fetch step appear under the `["codesmith", "jira"]` log category.

## AWS Bedrock bearer-token setup

The implemented agent pipeline calls Claude through the AWS Bedrock Runtime Converse API.
For the current local setup, the expected auth path is bearer-token auth.

Required values:

- `AWS_REGION`
- `AWS_BEARER_TOKEN_BEDROCK`
- `AWS_AUTH_SCHEME_PREFERENCE='smithy.api#httpBearerAuth'`

If Bedrock auth is misconfigured, the webhook can still return `202 Accepted` because the
review runs in the background, but the pipeline will later fail in `logs/codesmith-dev.log` with
credential or authorization errors.

## LLM provider fallback (Phase 5.3)

By default, CodeSmith uses AWS Bedrock as the sole LLM provider. You can configure
additional providers as automatic fallbacks: if Bedrock is unavailable (rate-limited,
service disruption, or credential error), CodeSmith retries automatically with the next
provider in the list without dropping the review.

### Environment variables

```env
# Comma-separated, tried left-to-right. Supported: bedrock, openai, google.
LLM_PROVIDER_ORDER=bedrock,openai

# OpenAI (required when "openai" is in LLM_PROVIDER_ORDER)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o   # optional, this is the default

# Google Gemini (required when "google" is in LLM_PROVIDER_ORDER)
GOOGLE_AI_API_KEY=AIza...
GOOGLE_AI_MODEL=gemini-1.5-pro   # optional, this is the default
```

### How fallback works

Each provider is attempted in the order listed. If a provider call throws (any error), the
error is logged as a warning and the next provider is tried immediately. The review
continues with the first provider that succeeds. If all providers fail, the pipeline error
is propagated and the MR review fails.

To use only a single non-Bedrock provider, set `LLM_PROVIDER_ORDER` to just that provider:

```env
LLM_PROVIDER_ORDER=openai
```

Bedrock credentials are then not required.

## Task queue setup (Phase 5.1)

By default, CodeSmith runs in fire-and-forget mode: the webhook handler dispatches the
review pipeline in the background without a queue. This mode requires no additional
infrastructure.

For production deployments where you want durability, retries, and separate scaling for
the webhook server and the review worker, enable the BullMQ task queue backed by Valkey
(a Redis-compatible key-value store).

### Environment variables

```env
QUEUE_ENABLED=true
VALKEY_URL=redis://localhost:6379
WORKER_CONCURRENCY=2   # concurrent review jobs per worker process
REVIEW_JOB_TIMEOUT_MS=600000   # 10 minutes per attempt
```

### Starting the worker

When `QUEUE_ENABLED=true`, you must run a separate worker process that picks up jobs from
the queue and executes the review pipeline. In a terminal alongside the webhook server:

```bash
bun run worker
```

If `QUEUE_ENABLED=false` and you start the worker anyway, it will log a warning and continue
running but no jobs will arrive.

### Docker Compose with queue enabled

The `docker-compose.yml` already includes `valkey` and `worker` services. Start the full
stack with:

```bash
docker-compose up
```

The `worker` service uses an 11-minute `stop_grace_period` so an in-flight review (which
can take up to 10 minutes) is not interrupted on `docker-compose down`.

### Local KinD bootstrap

For local Kubernetes validation, CodeSmith includes helper scripts that create a KinD
cluster, build and load the local image, generate the ConfigMap and Secret from your local
`.env`, deploy the manifests, and wait for the webhook, worker, and Valkey rollouts.

Prerequisites:

- `docker`
- `kind`
- `kubectl`
- a populated local `.env`

Commands:

```bash
bun run kind:up
bun run kind:port-forward
bun run kind:down
```

`bun run kind:port-forward` exposes the webhook service on `http://127.0.0.1:8020`, so the
same health check and webhook URL can be used locally:

```bash
curl http://127.0.0.1:8020/api/v1/health
```

If your GitLab instance uses a private CA and `GITLAB_CA_FILE` is set in `.env`, the KinD
bootstrap path also creates a CA-bundle Secret and mounts it into both the webhook and worker
Deployments.

### Job lifecycle

Each review job is attempted up to three times with exponential backoff (5s → 10s → 20s).
Each attempt is bounded by `REVIEW_JOB_TIMEOUT_MS`; when the timeout is exceeded, the attempt
fails and BullMQ retry logic takes over. After the final failed attempt, the worker copies the
job payload plus failure metadata into the `review-dead-letter` queue for post-mortem analysis.
Completed jobs are retained for observability (last 100). Failed jobs are retained for
post-mortem inspection (last 200). You can inspect the queue state using
[BullMQ Board](https://github.com/felixmosh/bull-board) or any Redis/Valkey client.

## GitLab deployment compatibility

CodeSmith works with both GitLab.com and self-hosted GitLab (GitLab Self-Managed and GitLab Dedicated) without any deployment-mode flag. The supported auth and URL combinations are documented below.

### Supported deployment matrix

| Deployment | API auth | Clone auth | TLS cert | Notes |
|---|---|---|---|---|
| **GitLab.com** | PAT via `GITLAB_TOKEN` | `oauth2:<token>@gitlab.com` | Public (trusted by default) | No extra config needed |
| **Self-hosted — public cert** | PAT via `GITLAB_TOKEN` | `oauth2:<token>@your-host` | Public or valid CA (trusted) | No extra config needed |
| **Self-hosted — internal CA** | PAT via `GITLAB_TOKEN` | `oauth2:<token>@your-host` | Privately signed (enterprise PKI) | Set `GITLAB_CA_FILE` (see below) |

### Token types

CodeSmith uses a Personal Access Token (PAT) in two places:
- **GitLab REST API calls** — `@gitbeaker/rest` uses `GITLAB_TOKEN` as a private token
- **HTTPS git clone / fetch** — the token is injected as `oauth2:<token>` HTTP basic auth in the clone URL

The `oauth2` username with the PAT as the password is the standard GitLab HTTPS clone auth mechanism. It works identically for GitLab.com and self-hosted instances. No SSH key setup is required.

### GitLab URL with a subpath

If your self-hosted GitLab is deployed at a subpath (e.g. `https://company.com/gitlab`), set `GITLAB_URL` to the full base path including the subpath:

```env
GITLAB_URL=https://company.com/gitlab
```

Both the REST API client and the SSRF host guard use this value directly. The clone URL host is validated against `GITLAB_URL`'s hostname component, so both root and subpath deployments are handled without extra config.

### Self-hosted GitLab with an internal / enterprise CA

If your GitLab instance uses a certificate signed by an internal CA (common in enterprise environments), git clone operations and API calls will fail with TLS errors unless CodeSmith is told about the CA.

Set `GITLAB_CA_FILE` to the absolute path of a PEM-encoded CA bundle:

```env
GITLAB_CA_FILE=/etc/ssl/certs/your-internal-ca.pem
```

What this does at runtime:
- **Git subprocesses** (`clone`, `fetch`): `GIT_SSL_CAINFO` is injected into the subprocess environment so git uses the CA bundle for HTTPS certificate verification
- **API client** (`@gitbeaker/rest`): `NODE_EXTRA_CA_CERTS` is set to the same path at startup (`src/index.ts`), before any TLS connections are opened, so Bun's TLS layer trusts the CA bundle for all outgoing HTTPS requests

The CA bundle file must be readable by the CodeSmith process. In Docker, mount the file into the container and set `GITLAB_CA_FILE` to the mounted path. For enterprise deployments the bundle is typically the organization's root CA certificate in PEM format.

## 3. Start the service

```bash
bun run dev
```

The server listens on `PORT` from the config, default `8020`.

## 4. Verify health

```bash
curl http://localhost:8020/api/v1/health
```

Expected response:

```json
{"status":"ok","timestamp":"2026-03-14T00:00:00.000Z"}
```

## 5. Send a sample webhook

```bash
curl -X POST http://localhost:8020/api/v1/webhooks/gitlab \
	-H "Content-Type: application/json" \
	-H "X-Gitlab-Token: <your-webhook-secret>" \
	-d @tests/fixtures/sample_mr_event.json
```

Current behavior:

- matching merge request events return `202 Accepted`
- non-matching but valid events return `200 Ignored`
- accepted events continue through the full pipeline: MR fetch, repo clone/update, agent review, and GitLab publishing
- every accepted request carries `requestId`, `projectId`, and `mrIid` through the log context

## 6. Understand the current scope

Implemented now:

- Hono listener and health endpoint
- required-field Zod webhook parsing with permissive handling of extra GitLab keys
- GitLab client wrapper
- repo cache manager
- modular tool surface for repository investigation
- internal CodeSmith message and tool protocol between the agent runtime and provider adapter
- integrated multi-agent review subsystem (context, investigator, reflection, orchestrator)
- end-to-end pipeline: webhook → agents → GitLab inline comments + summary note
- GitLab publisher with duplicate detection
- recoverable Agent 2 tool errors, returned to the model as error tool results
- structured logging via LogTape: JSON Lines to stdout, `LOG_LEVEL` filtering, request correlation
- Jira read-only ticket enrichment: key extraction from MR title/description, REST API fetch, ADF description parsing, acceptance-criteria custom-field support, graceful degradation
- BullMQ + Valkey queueing with a separate worker process, retry policy, timeout boundary, and dead-letter handling
- multi-provider LLM fallback via `LLM_PROVIDER_ORDER` with Bedrock, OpenAI, and Google adapters
- KinD and Kubernetes manifests for local cluster validation and deployment parity
- review checkpoint ledger persisted in GitLab summary notes
- incremental automatic review scope selection (`full`, `incremental`, `skip`) with compare-diff analysis for unreviewed ranges
- metadata-only update skipping, explicit automatic-draft policy, and same-branch serialization for idempotent automatic delivery handling

Every accepted webhook emits logs with a unique `requestId` plus `projectId` and `mrIid` for end-to-end traceability.

Set `LOG_LEVEL=debug` for verbose per-agent output, or `LOG_LEVEL=warn` for quiet production deployments. In debug mode, logs are also written to `logs/codesmith-dev.log` under the project root.

Still planned:

- CodeSmith Awakening trigger aliases, acknowledgement notes, and tone-aware summary behavior
- Phase 5.5 optional adapter evaluation remains deferred by the master plan
- Phase 6 Jira write actions remain deferred pending explicit scope and security review

## Useful next commands

```bash
bun test
bun run typecheck
bun run check
```

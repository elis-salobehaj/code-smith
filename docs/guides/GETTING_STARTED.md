# Getting Started

This guide gets the current implemented GitGandalf runtime running locally.

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

## GitLab personal access token (GLPAT)

This service uses `GITLAB_TOKEN` in two places:

- GitLab API calls to read MR data and publish review comments
- HTTPS git clone/fetch operations in the repo cache manager

Create a token with a dedicated bot or service account when possible.

For GitLab.com or self-hosted GitLab:

1. Open GitLab and go to your avatar → Preferences or Edit profile → Access tokens.
2. Create a personal access token named something like `git-gandalf-local-dev`.
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
4. Set the webhook URL to your GitGandalf endpoint.
5. Paste the same secret into the webhook secret/token field.
6. Subscribe to merge request events and, if you want `/ai-review`, note events.

The exact field label varies slightly by GitLab version, but the value must match the
`X-Gitlab-Token` header GitLab sends.

## Project webhook vs system hook

If your goal is to have GitGandalf review merge requests across the entire GitLab instance,
a system hook is a valid approach on self-hosted GitLab when you have administrator access.

What works well with a system hook today:

- one admin-level webhook instead of configuring each project separately
- merge request events across the whole instance
- the same shared-secret validation using `X-Gitlab-Token`

Important limits:

- system hooks are an administrator feature for GitLab Self-Managed and GitLab Dedicated, not the general GitLab.com path
- the current runtime is built around merge request and note events; a system hook covers merge request review triggers, but `/ai-review` note-triggered reviews still need a project-level or group-level webhook path
- if you need compatibility with both GitLab.com and self-hosted deployments, keep project webhooks as the baseline configuration until the planned Phase 4.6 compatibility work is complete

### Option A: project webhook

Use this when:

- you want the most portable setup
- you need `/ai-review` note events today
- you are running on GitLab.com or do not have instance-admin access

Setup:

1. Open the target project.
2. Go to Settings → Webhooks.
3. Set the webhook URL to your GitGandalf endpoint.
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
3. Add a new webhook pointing at your GitGandalf endpoint.
4. Paste the same `GITLAB_WEBHOOK_SECRET` into the secret token field.
5. Enable at least merge request events.

If you want fully instance-wide automatic reviews, this is the simplest operational model.
If you also want manual `/ai-review` triggers from MR comments, keep a project or group webhook
for note events as well.

## Webhook reachability

GitLab must be able to make an HTTP request to the GitGandalf webhook URL.

What this means in practice:

- if GitLab and GitGandalf run on the same machine, `http://localhost:8020` can work
- if GitLab runs on a different machine, `localhost` on your laptop is not reachable from GitLab
- a reverse proxy is only useful if GitLab can already reach the proxy and the proxy can route traffic to your GitGandalf process

Common setups:

1. Run GitGandalf on a host GitLab can reach directly, then use `http://that-host:8020/api/v1/webhooks/gitlab` or an HTTPS URL in front of it.
2. For early testing, create an SSH reverse tunnel from your machine to a host GitLab can reach.
3. For longer-lived environments, run GitGandalf on a reachable host directly.

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

For self-hosted GitLab system hooks, remember one more constraint: the GitLab instance itself must be allowed to send requests to that destination. If GitGandalf is only listening on your local machine, GitLab will need either a network route to it or a tunnel/proxy endpoint that is reachable from the GitLab server.

## Jira setup

Jira ticket fetching is live and optional. When enabled, GitGandalf reads ticket keys from the MR title and description, fetches each ticket from the Jira REST API, and passes the context to Agent 1 before the review begins. This step always degrades gracefully — if Jira is unavailable or a ticket cannot be fetched, the review continues without ticket context.

The integration is **disabled by default** (`JIRA_ENABLED=false`). Existing deployments are unaffected until you opt in.

### Jira API token

GitGandalf uses Jira Cloud's REST API v3 with Basic Auth. The credential is `email:api_token`, base64-encoded in each request header.

To create a token:

1. Log in to your Atlassian account (even if your org uses SSO via Okta, Azure AD, or similar, you can still generate API tokens from the Atlassian account portal).
2. Go to **https://id.atlassian.com/manage-profile/security/api-tokens** (not the Jira project settings — this is the Atlassian account-level page).
3. Click **Create API token**, give it a label (e.g. `git-gandalf`), and copy the value immediately — it is not shown again.
4. Set `JIRA_EMAIL` to the email address on that Atlassian account and `JIRA_API_TOKEN` to the copied token.

**Critical:** paste `JIRA_API_TOKEN` as a **single unbroken line** in `.env`. A line break anywhere in the token value causes it to be read as two separate variables and Jira will return `401 Client must be authenticated`.

**SSO note:** if your organization enforces SAML SSO via Atlassian Access and has additionally restricted API token usage, API tokens may not work for accounts governed by that policy. In that case, ask an Atlassian administrator to either exempt a service account from the restriction or create a dedicated non-SSO Jira account for GitGandalf.

### Recommended: read-only service account

For production use, create a dedicated Jira account (e.g. `git-gandalf-bot@your-company.com`) and grant it only **Browse Projects** permission on the relevant Jira project permission scheme. Generate the API token for that account. This limits blast radius: if the token is ever compromised, it cannot write to Jira or access projects it has not been explicitly granted.

### Environment variables

```env
JIRA_ENABLED=true
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=git-gandalf-bot@your-company.com
JIRA_API_TOKEN=<paste full token on one line>
# Optional: restrict lookups to specific project keys
JIRA_PROJECT_KEYS=SRT,ENG
# Optional: custom field ID for acceptance criteria
# JIRA_ACCEPTANCE_CRITERIA_FIELD_ID=customfield_12345
```

### How it works at runtime

Once enabled, the pipeline extracts ticket keys from the MR title and description using the pattern `[A-Z][A-Z0-9]+-\d+`. The most common pattern in practice is a title that begins with the ticket key followed by a colon — for example `SRT-28326: refactor authentication layer`. GitGandalf handles this automatically; you do not need to configure any title format.

Keys found in both the title and description are deduplicated. The `JIRA_PROJECT_KEYS` allow-list filters out keys from projects you do not want GitGandalf to look up. `JIRA_MAX_TICKETS` (default 5) caps the number of API calls per review run.

Resolved tickets are attached to `ReviewState.linkedTickets` and included in Agent 1's prompt as a `## Linked Jira Tickets` section with the ticket's summary, status, issue type, priority, assignee, description, and acceptance criteria. All logs from the Jira fetch step appear under the `["gandalf", "jira"]` log category.

## AWS Bedrock bearer-token setup

The implemented agent pipeline calls Claude through the AWS Bedrock Runtime Converse API.
For the current local setup, the expected auth path is bearer-token auth.

Required values:

- `AWS_REGION`
- `AWS_BEARER_TOKEN_BEDROCK`
- `AWS_AUTH_SCHEME_PREFERENCE='smithy.api#httpBearerAuth'`

If Bedrock auth is misconfigured, the webhook can still return `202 Accepted` because the
review runs in the background, but the pipeline will later fail in `logs/gg-dev.log` with
credential or authorization errors.

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
- internal GitGandalf message and tool protocol between the agent runtime and provider adapter
- integrated multi-agent review subsystem (context, investigator, reflection, orchestrator)
- end-to-end pipeline: webhook → agents → GitLab inline comments + summary note
- GitLab publisher with duplicate detection
- recoverable Agent 2 tool errors, returned to the model as error tool results
- structured logging via LogTape: JSON Lines to stdout, `LOG_LEVEL` filtering, request correlation
- Jira read-only ticket enrichment: key extraction from MR title/description, REST API fetch, ADF description parsing, acceptance-criteria custom-field support, graceful degradation

Every accepted webhook emits logs with a unique `requestId` plus `projectId` and `mrIid` for end-to-end traceability.

Set `LOG_LEVEL=debug` for verbose per-agent output, or `LOG_LEVEL=warn` for quiet production deployments. In debug mode, logs are also written to `logs/gg-dev.log` under the project root.

Still planned:

- Phase 4.6 GitLab.com and self-hosted compatibility hardening
- Phase 5 production hardening (task queue, Kubernetes, provider fallback)

## Useful next commands

```bash
bun test
bun run typecheck
bun run check
```

# CodeSmith: Agent Operating Manual

## 🎯 Mission

Self-hosted, multi-agent code review service for GitLab. Intercepts MR events,
deeply reasons about code changes using LLM-powered agents, and posts
high-signal inline review comments.

## ⚙️ Stack Essentials

- **Runtime**: Bun (runtime + package manager + bundler + test runner)
- **Framework**: Hono (ultralight, Web Standards)
- **Language**: TypeScript (strict mode)
- **Validation**: Zod (all schemas, env config, API payloads)
- **LLM**: AWS Bedrock Runtime Converse via `@aws-sdk/client-bedrock-runtime` (Claude Sonnet 4), behind CodeSmith's internal agent protocol
- **GitLab Client**: @gitbeaker/rest
- **Linting/Formatting**: Biome (replaces ESLint + Prettier)

## 🚨 Critical Rules

1. **Use Bun exclusively**: `bun install`, `bun run`, `bun test`, `bunx`.
   Never npm/npx/yarn.
2. **Zod for all validation**: Config, webhooks, API responses, agent outputs.
   Never use `as` casts for external data — always `.parse()` or `.safeParse()`.
3. **Biome for all formatting/linting**: Run `bun run check` before committing.
   Never add ESLint or Prettier — Biome replaces both.
4. **Update plans**: Check off tasks in `docs/plans/active/*.md` as completed.
5. **Update docs index**: Update `docs/README.md` when plans change status.
6. **Security**: All file/search tools sandboxed to cloned repo paths.
   Path traversal blocked via `path.resolve()` + prefix check.
7. **Internal protocol is the app boundary**: keep provider-specific message/tool shapes contained in `src/agents/llm-client.ts` and `src/agents/protocol.ts`.

## 📖 Guides

- **Architecture**: [`docs/context/ARCHITECTURE.md`](docs/context/ARCHITECTURE.md)
- **Configuration**: [`docs/context/CONFIGURATION.md`](docs/context/CONFIGURATION.md)
- **Workflows**: [`docs/context/WORKFLOWS.md`](docs/context/WORKFLOWS.md)

## 🧭 Documentation Structure

- **Core context**:
   - `docs/context/*` — Architecture, configuration, and workflow references used by both humans and agents
- **Design docs**:
   - `docs/designs/*` — Deeper design records, diagrams, and rationale
- **Plans**: `docs/plans/{active,backlog,implemented}/*`

Agents MUST default to `docs/context/*` and then read `docs/designs/*` only when implementation or review work needs deeper rationale.

## 🔧 Agent Skills

Skills follow the [Agent Skills open standard](https://agentskills.io).
Located at `.agents/skills/<skill-name>/SKILL.md`.
Auto-discovered by Cursor, VSCode Copilot, OpenCode, and Antigravity.

Current repo skills include:
- `bun-project-conventions` for Bun-native implementation and review work
- `plan-implementation` for producing thorough, repo-aware implementation plans
- `review-plan-implementation` for ruthless pre-implementation plan audits (architecture, security, dependencies, resilience)
- `review-plan-phase` for principal-engineer audits of plan-driven implementation phases with auto-remediation
- `conventional-commits` for composing and validating git commit messages

## ✅ Plan Completion Gate

When work is driven by a markdown plan file, do not mark a phase, milestone, or plan item complete until you have run the `review-plan-phase` skill or performed the equivalent review standard yourself.

For plan-driven work, agents must:
- compare the implementation against the governing plan file item by item
- verify adherence to this file, including Bun-only workflows, Zod validation at external boundaries, Biome conventions, and security requirements
- inspect whether the implementation is thorough rather than scaffolded, shallow, or shortcut-based
- verify tests are present and meaningful where the plan implies new behavior
- verify all required documentation and plan-tracking updates were completed, including `docs/README.md` and relevant files under `docs/plans/`
- produce a report that distinguishes what was implemented correctly from what was missed or still needs work

If the review identifies gaps, do not start remediation automatically unless the review determines no human decisions are needed. The `review-plan-phase` skill handles both review and remediation in a single pass — it auto-remediates when safe and stops for human input when architectural or scope decisions are required.

Do not present a plan phase as complete based only on passing checks, partial scaffolding, or code that roughly resembles the plan. Completion requires alignment across implementation, tests, documentation, and plan bookkeeping.

## 🗺️ Active Work

Always check [`docs/README.md`](docs/README.md) for current plans and priorities.

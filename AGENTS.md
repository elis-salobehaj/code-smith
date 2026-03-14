# GitGandalf: Agent Operating Manual

## 🎯 Mission

Self-hosted, multi-agent code review service for GitLab. Intercepts MR events,
deeply reasons about code changes using LLM-powered agents, and posts
high-signal inline review comments.

## ⚙️ Stack Essentials

- **Runtime**: Bun (runtime + package manager + bundler + test runner)
- **Framework**: Hono (ultralight, Web Standards)
- **Language**: TypeScript (strict mode)
- **Validation**: Zod (all schemas, env config, API payloads)
- **LLM**: AWS Bedrock via @anthropic-ai/bedrock-sdk (Claude Sonnet 4)
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

## 📖 Guides

- **Architecture**: [`docs/agents/context/ARCHITECTURE.md`](docs/agents/context/ARCHITECTURE.md)
- **Configuration**: [`docs/agents/context/CONFIGURATION.md`](docs/agents/context/CONFIGURATION.md)
- **Workflows**: [`docs/agents/context/WORKFLOWS.md`](docs/agents/context/WORKFLOWS.md)

## 🧭 Documentation Structure

- **Agent docs** (concise, token-optimized):
  - `docs/agents/context/*` — Architecture, config, workflow rules
  - `docs/agents/designs/*` — Compact design decision summaries
- **Human docs** (detailed, visual):
  - `docs/humans/context/*` — Full rationale, diagrams, onboarding
  - `docs/humans/designs/*` — Full design docs with mermaid and ELI5
- **Plans**: `docs/plans/{active,backlog,implemented}/*`

Agents MUST default to `docs/agents/*` to minimize context window usage.

## 🔧 Agent Skills

Skills follow the [Agent Skills open standard](https://agentskills.io).
Located at `.agents/skills/<skill-name>/SKILL.md`.
Auto-discovered by Cursor, VSCode Copilot, OpenCode, and Antigravity.

## 🗺️ Active Work

Always check [`docs/README.md`](docs/README.md) for current plans and priorities.

# Git-Gandalf: Repository Setup & Agentic Development Plan

> All decisions finalized. This plan covers GitHub repo bootstrap, documentation structure, Agent Skills setup, linting/formatting, and file organization.

---

## 1. GitHub Repository Setup

### Steps

1. `gh repo create git-gandalf --public --license apache-2.0 --clone=false`
2. Initialize local git in `/home/elis/projects/git-gandalf`
3. Add GitHub remote, commit only the LICENSE, push to main
4. Existing `.md` files remain uncommitted until moved to their proper doc locations

> [!NOTE]
> **CLA Bot**: Apache 2.0 includes a patent grant. When ready for external contributions, add a CLA bot (e.g., `cla-assistant` GitHub App). No action needed now.

---

## 2. Documentation Structure

### Finalized Layout

```
git-gandalf/
├── AGENTS.md                                    # Root agent operating manual
├── LICENSE                                       # Apache 2.0
├── README.md                                     # Project overview (Phase 1)
├── .agents/
│   └── skills/
│       └── bun-project-conventions/
│           └── SKILL.md                          # Starter skill (open standard)
├── src/
│   └── agents/
│       └── prompts/
│           └── system-prompt.md                  # ← GG persona (source code asset)
├── docs/
│   ├── README.md                                 # Documentation index & navigation
│   ├── agents/                                   # Agent-optimized (concise, token-efficient)
│   │   ├── README.md
│   │   ├── context/
│   │   │   ├── ARCHITECTURE.md
│   │   │   ├── CONFIGURATION.md
│   │   │   └── WORKFLOWS.md
│   │   └── designs/                              # Compact design summaries for agents
│   │       └── tech-stack-evaluation.md
│   ├── humans/                                    # Human-readable (detailed, visual)
│   │   ├── README.md
│   │   ├── context/
│   │   │   └── ARCHITECTURE.md                    # Expanded with mermaid, ELI5
│   │   └── designs/                               # Full design docs with diagrams
│   │       └── tech-stack-evaluation.md
│   ├── plans/
│   │   ├── active/
│   │   │   └── git-gandalf-master-plan.md
│   │   ├── backlog/
│   │   └── implemented/
│   └── guides/
│       ├── GETTING_STARTED.md
│       └── DEVELOPMENT.md
```

### Key Design Decisions

#### Split `designs/` per Track (NOT shared)

| Track | Audience | Content Style | Why |
|-------|----------|---------------|-----|
| `docs/agents/designs/` | LLM agents | Compact tables, decision summaries, no mermaid | **~30-50% fewer tokens** |
| `docs/humans/designs/` | Humans | Full mermaid diagrams, ELI5 explanations | Comprehensive onboarding |

**Rule**: Write the full version in `docs/humans/designs/`, then create a compact summary in `docs/agents/designs/`.

#### System Prompt → `src/agents/prompts/system-prompt.md`

The GG wizard persona is a runtime asset consumed by the LLM agent pipeline. It belongs in source code because:
- It will be `import`ed / `Bun.file()`'d by `src/agents/context-agent.ts`
- It evolves alongside agent code, not documentation
- `docs/` is for human/agent guidance; `src/` is for runtime assets

---

## 3. Agent Skills — Open Standard (`.agents/skills/`)

### The Standard

[Agent Skills](https://agentskills.io) is an Anthropic-backed open standard for extending AI agents. It defines a universal format for packaging reusable knowledge, workflows, and scripts.

### Cross-IDE Discovery

All major IDEs auto-discover `.agents/skills/<name>/SKILL.md`:

| IDE | Project-level Discovery Path | Status |
|-----|------------------------------|--------|
| **Cursor** | `.agents/skills/`, `.cursor/skills/` | ✅ Native |
| **VSCode Copilot** | `.agents/skills/`, `.github/skills/` | ✅ Native |
| **OpenCode** | `.agents/skills/`, `.opencode/skills/` | ✅ Native |
| **Google Antigravity** | `.agents/skills/` | ✅ Native |

> [!TIP]
> **`.agents/skills/` is the universal path.** Every IDE that supports the Agent Skills standard discovers it. No IDE-specific adapter files needed.

### SKILL.md Format (from spec)

```yaml
---
name: skill-name                    # Required. Lowercase, hyphens, must match folder name
description: What this does         # Required. Agent uses this to decide relevance (max 1024 chars)
license: Apache-2.0                 # Optional
compatibility: all                  # Optional
metadata:                           # Optional key-value map
  audience: developers
---
```

Body is markdown with instructions, "When to Use", and step-by-step guidance.

### Optional Directories

| Directory | Purpose |
|-----------|---------|
| `scripts/` | Executable code agents can run |
| `references/` | Additional docs loaded on demand (progressive disclosure) |
| `assets/` | Static resources like templates, config files |

### Starter Skill: `bun-project-conventions`

**Why**: Catches the #1 agent mistake — using npm/Node.js APIs instead of Bun-native ones.

```markdown
---
name: bun-project-conventions
description: >
  Bun-specific conventions for the git-gandalf project.
  Use when writing or modifying TypeScript code, running commands,
  or managing dependencies. Ensures Bun-native APIs are used
  instead of Node.js equivalents.
license: Apache-2.0
---

# Bun Project Conventions

## Package Management
- **Install**: `bun install` (never `npm install` or `yarn`)
- **Run scripts**: `bun run <script>` (never `npm run`)
- **Execute binaries**: `bunx <package>` (never `npx`)
- **Add dependency**: `bun add <package>`
- **Add dev dependency**: `bun add -d <package>`

## Runtime APIs (prefer Bun-native)

| Instead of (Node.js) | Use (Bun) | Why |
|----------------------|-----------|-----|
| `fs.readFile()` | `Bun.file(path).text()` | Zero-copy, faster |
| `fs.writeFile()` | `Bun.write(path, data)` | Optimized |
| `child_process.spawn()` | `Bun.spawn(cmd, opts)` | Uses `posix_spawn(3)`, fastest subprocess |
| `child_process.exec()` | `Bun.spawn()` with `stdout: 'pipe'` | Same reason |
| `crypto.randomUUID()` | `Bun.randomUUIDv7()` | Sortable UUIDs |

## Testing
- Use `bun test` (built-in, Jest-compatible API)
- Test files: `*.test.ts` pattern
- Use `describe()`, `it()`, `expect()` — all built-in

## Hot Reload
- Dev server: `bun run --hot src/index.ts`
- `--hot` preserves state between reloads (unlike `--watch` which restarts)

## Environment Variables
- Bun auto-loads `.env` files (no `dotenv` package needed)
- Access via `Bun.env`
```

---

## 4. AGENTS.md (Finalized Draft)

```markdown
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
```

---

## 5. Linting/Formatting — Biome (Confirmed)

### Bun Does NOT Have Built-in Linting or Formatting

Bun's "all-in-one" covers runtime, package manager, bundler, and test runner — but **NOT** linting or formatting. There is an open GitHub issue but no implementation as of March 2026.

### Biome is the Clear Choice

| Concern | ESLint + Prettier | Biome |
|---------|-------------------|-------|
| **Speed** | ~seconds for large projects | **~25x faster** (Rust-based) |
| **Config files** | 2 configs + `eslint-config-prettier` | **Single `biome.json`** |
| **Philosophy** | Two separate tools | **One tool** — aligns with Bun's all-in-one spirit |
| **TypeScript** | ESLint flat config still evolving | **First-class TypeScript** from day one |
| **Import sorting** | Needs plugin | **Built-in** |

### Proposed `biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.7/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": { "noUnusedVariables": "error" },
      "suspicious": { "noExplicitAny": "error" },
      "style": { "useConst": "error" }
    }
  },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  }
}
```

### Updated `package.json` Scripts

```json
{
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "lint": "biome lint .",
    "format": "biome format --write .",
    "check": "biome check --write .",
    "ci": "biome ci . && tsc --noEmit && bun test"
  }
}
```

### Zod Strict Usage Policy

- **All external data boundaries** use Zod: env config, webhook payloads, LLM responses, tool inputs
- **`z.object().strict()`** on schemas where unexpected keys must be rejected
- **No `as` type casts** for external data — always `.parse()` or `.safeParse()`
- **Export inferred types**: `type Config = z.infer<typeof configSchema>`

---

## 6. File Movement Plan

| Current Location | New Location | Notes |
|-----------------|-------------|-------|
| `git-gandalf-master-plan.md` | `docs/plans/active/git-gandalf-master-plan.md` | Move |
| `tech-stack-evaluation-design-choices.md` | `docs/humans/designs/tech-stack-evaluation.md` | Full version (humans) |
| *(create new)* | `docs/agents/designs/tech-stack-evaluation.md` | Compact summary (agents) |
| `gg-system-prompt.md` | `src/agents/prompts/system-prompt.md` | Runtime asset |

---

## 7. Master Plan Updates Required

Add to Phase 1 of `git-gandalf-master-plan.md`:

1. **`[NEW] biome.json`** — Biome configuration (lint + format + import sorting)
2. **`[NEW] .agents/skills/bun-project-conventions/SKILL.md`** — Agent Skill
3. **Updated `package.json` scripts** — Add `lint`, `format`, `check`, `ci`
4. **Zod strict policy** — Elevate to Phase 1 foundational concern

---

## Summary of All Decisions

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | Workflows | ❌ **Removed** — skills cover the same use cases with better cross-IDE portability |
| 2 | Skills | ✅ `.agents/skills/` — follows the [Agent Skills open standard](https://agentskills.io). Starter: `bun-project-conventions` |
| 3 | Skills path | ✅ `.agents/skills/` (not `_agents/`) — universal auto-discovery across all IDEs |
| 4 | Split designs | ✅ `agents/designs/` (compact) + `humans/designs/` (full) — token optimization |
| 5 | System prompt | ✅ `src/agents/prompts/system-prompt.md` — runtime asset, not docs |
| 6 | Biome | ✅ Confirmed. **Bun has no built-in linter/formatter** — Biome is the only all-in-one option |
| 7 | Cross-IDE | ✅ `.agents/skills/` is universally discovered. `AGENTS.md` + `docs/agents/` works everywhere |

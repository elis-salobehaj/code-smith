# GitGandalf Documentation

## 🤖 Agent Documentation (`docs/agents/`)

Concise, token-optimized reference for LLM agents. Prefer these over human docs to minimize context window usage.

- [Architecture](./agents/context/ARCHITECTURE.md) — System components, agent pipeline, and data flow *(Phase 1)*
- [Configuration](./agents/context/CONFIGURATION.md) — Environment variables and runtime config reference *(Phase 1)*
- [Workflows](./agents/context/WORKFLOWS.md) — Operational patterns and agent decision rules *(Phase 1)*
- [Tech Stack Design](./agents/designs/tech-stack-evaluation.md) — Stack decisions and rationale summary

## 👥 Human Documentation (`docs/humans/`)

Detailed, visual documentation with Mermaid diagrams and full rationale.

- [Architecture](./humans/context/ARCHITECTURE.md) — Full architecture with diagrams and ELI5 explanations *(Phase 1)*
- [Tech Stack Design](./humans/designs/tech-stack-evaluation.md) — Complete ecosystem analysis and technology decisions

## 📚 Guides (`docs/guides/`)

- [Getting Started](./guides/GETTING_STARTED.md) — Prerequisites, setup, and first run *(Phase 1)*
- [Development](./guides/DEVELOPMENT.md) — Local workflow, testing, and Biome conventions *(Phase 1)*

## 📋 Implementation Plans (`docs/plans/`)

- **Active**: [GitGandalf Master Plan](./plans/active/git-gandalf-master-plan.md) — Phases 1–5 implementation roadmap
- **Implemented**: [Agentic Development Plan](./plans/implemented/agentic-development-plan.md) — Repo bootstrap and dev tooling setup

### Implementation Status

| Phase | Status | Summary |
|---|---|---|
| **Phase 1** | ✅ Complete | Hono server, Zod webhook parsing, GitLab client, 15 tests |
| **Phase 2** | 🔜 Next | Agent tools & context engine (repo clone, file/search tools) |
| **Phase 3** | ⬜ Planned | Multi-agent pipeline (context, investigator, reflection agents) |
| **Phase 4** | ⬜ Planned | GitLab publisher (inline comments, summary comment) |
| **Phase 5** | ⬜ Planned | Hardening, BullMQ queue, Docker Compose |

> *(Phase 1)* — documentation stub files to be filled in during Phase 2+ implementation.

# Agent Documentation

This directory contains concise, token-optimized documentation intended for agent consumption. Prefer these files over the human docs when building context for implementation or review work.

## Context References

- [Architecture](./context/ARCHITECTURE.md) — current runtime surface, webhook flow, repo manager, tool system, and planned boundaries
- [Configuration](./context/CONFIGURATION.md) — compact env var table sourced from `src/config.ts`
- [Workflows](./context/WORKFLOWS.md) — implemented request flow, repo cache workflow, tool dispatch, and future handoff points

## Design References

- [Tech Stack Evaluation](./designs/tech-stack-evaluation.md) — concise summary of why Bun, Hono, Zod, Bedrock, and native Git were selected

## Usage Rule

When both agent and human docs exist for the same topic, agents should default to the `docs/agents/` version unless detailed rationale or diagrams are required.

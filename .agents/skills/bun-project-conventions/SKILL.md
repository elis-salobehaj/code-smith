---
name: bun-project-conventions
description: >
  Bun-specific conventions for the code-smith project. Covers package management,
  runtime APIs, testing, CI, Biome linting/formatting, Zod validation patterns, and
  TypeScript strict-mode configuration. Use when creating or modifying Bun projects,
  replacing Node-first tooling, reviewing TS code for Bun best practices, or enforcing
  Bun-only implementation choices. Also used as the compliance reference checklist
  during review-plan-phase audits.
argument-hint: 'Describe the Bun project task, file, or change to implement or review.'
license: Apache-2.0
---

# Bun Project Conventions

Use this skill when the project is intentionally Bun-first and Bun-specific choices are acceptable.

## Outcome

Produce Bun-native code and project changes that:
- use Bun commands, lockfiles, and CI flows consistently
- prefer Bun runtime APIs whenever Bun documents them as the best path
- avoid Node-first tools and compatibility shims unless they are still the documented recommendation
- use Bun's built-in test runner and current dependency-security controls

## When To Use

Use this skill for:
- adding or updating dependencies in a Bun project
- writing or refactoring TypeScript that runs on Bun
- replacing Node-first tooling such as `npm`, `npx`, `ts-node`, `tsx`, or `child_process`
- reviewing a project for outdated Bun conventions
- setting up Bun-based CI, tests, scripts, or workspace installs

Do not use this skill when the code must remain runtime-portable across Bun and non-Bun runtimes.

## Procedure

1. Confirm the project is Bun-first.
   Look for `bun.lock`, `bunfig.toml`, Bun-based scripts, Bun shebangs, or explicit Bun runtime usage.

2. Normalize commands and package management.
   Use:
   - `bun install` to install dependencies
   - `bun add`, `bun add -d`, `bun add --peer`, `bun add --optional` to manage dependency scopes
   - `bun run <script>` to run scripts
   - `bunx <tool>` for package executables
   - `bun ci` in CI for frozen, reproducible installs

   Avoid:
   - `npm`, `yarn`, `pnpm`, or `npx` in Bun-first workflows unless the repo explicitly requires them
   - `bun.lockb`; the current lockfile standard is `bun.lock`

3. Apply current dependency-management standards.
   - Commit `bun.lock`.
   - In CI, prefer `bun ci` instead of `bun install`.
   - For workspaces or monorepos, prefer Bun's isolated install model when configuring a new workspace.
   - Use `trustedDependencies` for packages that need lifecycle scripts instead of weakening install safety globally.
   - For new projects and security-sensitive repos, default to configuring `minimumReleaseAge` in `bunfig.toml` unless there is a clear reason not to.

4. Prefer Bun-native runtime APIs wherever Bun documents them as recommended.

   Preferred replacements:

   | Instead of | Prefer | Notes |
   |---|---|---|
   | `fs.promises.readFile(path, "utf8")` | `await Bun.file(path).text()` | Best for file reads |
   | `fs.promises.readFile(path)` for JSON | `await Bun.file(path).json()` | Use when the file is JSON |
   | `fs.promises.writeFile(path, data)` | `await Bun.write(path, data)` | Best for writes and file copies |
   | `child_process.spawn()` | `Bun.spawn()` | Best for async subprocesses |
   | `child_process.spawnSync()` / `execFileSync()` | `Bun.spawnSync()` | Best for CLI-style blocking execution |
   | `crypto.randomUUID()` | `Bun.randomUUIDv7()` when sortable IDs help | Keep `crypto.randomUUID()` only when standard UUID v4 semantics are explicitly required |
   | `dotenv` | Bun automatic `.env` loading | Bun loads `.env`, `.env.{env}`, and `.env.local` automatically |

   Keep Node-compatible APIs only where Bun still recommends them:
   - use `node:fs` for directory operations such as `mkdir` and `readdir`
   - use standard web APIs like `fetch`, `Request`, `Response`, `URL`, `ReadableStream`, and Web Crypto directly
   - keep `process.env` when library compatibility matters; prefer `Bun.env` or `import.meta.env` in app code

5. Use Bun-native execution patterns.
   - For scripts and CLIs, prefer direct Bun execution over `ts-node` or `tsx`.
   - For Bun-only CLIs, use the shebang `#!/usr/bin/env bun`.
   - Prefer `bun run --hot <entry>` for long-lived dev processes that benefit from state-preserving reloads.
   - Prefer `bun --watch` or `bun test --watch` when a full restart is desired.

6. Use Bun's built-in test runner.
   - Import test APIs from `bun:test`.
   - Use `bun test` for normal runs.
   - Use `bun test --watch` for local iteration.
   - Use `bun test --coverage` for coverage.
   - Use `bun test --reporter=junit --reporter-outfile=<file>` when CI needs JUnit output.
   - Use `test.concurrent` only for independent async tests.
   - Use `test.serial` when state or ordering matters.
   - Use `--randomize` or `--seed` when checking for order dependence.
   - Use `--retry` or `--rerun-each` for flaky-test diagnosis, not to mask a broken suite.

7. Apply CI and automation standards.
   - In GitHub Actions, use `oven-sh/setup-bun@v2`.
   - Install with `bun ci`.
   - Run project scripts with `bun run <script>`.
   - Keep CI examples and docs aligned with Bun commands only.

8. Apply Biome and strict TypeScript conventions.
   - Run `bun run check` (invokes `biome check --write .`) before committing to enforce lint and formatting in one pass.
   - Never introduce ESLint, Prettier, or other formatters — Biome replaces both.
   - Ensure `tsconfig.json` uses `"strict": true`, `"module": "ESNext"`, and `"moduleResolution": "bundler"`.
   - Run `bun run typecheck` (invokes `tsc --noEmit`) to catch type errors before committing.

9. Apply Zod validation at all external data boundaries.
   - Use Zod for every untrusted input: env vars, webhook payloads, API responses, LLM outputs.
   - Never use `as SomeType` to cast external data — always call `.parse()` (throws on failure) or `.safeParse()` (returns a result object for graceful per-request error handling).
   - Export inferred types alongside schemas: `export type Foo = z.infer<typeof fooSchema>`.
   - Prefer `z.object().strict()` on schemas where unexpected keys must be rejected (e.g., webhook payloads, config objects).
   - Use `.parse()` at app startup for env/config validation; use `.safeParse()` at per-request webhook and API boundaries.

## Decision Rules

- If Bun has a documented recommended native API, prefer it.
- If Bun says a Node API is still the recommended route for that area, keep the Node API.
- If the repo is Bun-first, do not preserve Node-first tooling just for familiarity.
- If IDs benefit from chronological ordering or database locality, prefer `Bun.randomUUIDv7()`.
- If code only needs a standard UUID and another system expects UUID v4 semantics, keep `crypto.randomUUID()`.
- If an external package exists only to fill a capability Bun already provides, remove the package unless there is a compatibility requirement.

## Completion Checks

Before finishing, verify:
- project commands use `bun`, not `npm`, `yarn`, `pnpm`, or `npx`
- new dependency changes update `bun.lock`
- CI uses `bun ci` where reproducible installs matter
- tests use `bun:test` and `bun test`
- `dotenv`, `ts-node`, `tsx`, or `child_process` are not introduced without a specific reason
- Bun-native APIs are used in the file and subprocess cases where Bun recommends them
- Node APIs remain only in areas where Bun still recommends `node:fs` or where compatibility requires them
- security defaults such as `trustedDependencies` and `minimumReleaseAge` are considered, not ignored by habit
- `bun run check` passes with no Biome lint or format errors
- `bun run typecheck` compiles with no TypeScript errors
- all untrusted inputs (env vars, webhooks, API responses, LLM outputs) are validated with Zod — no `as` casts on external data

## Preferred Prompts

- Audit this Bun repo for outdated Node-first conventions.
- Refactor this TypeScript file to follow Bun-native runtime conventions.
- Update this CI workflow to current Bun standards.
- Replace Node-based subprocess and file I/O usage with Bun-recommended APIs.
- Review this package.json and bunfig.toml for current Bun best practices.
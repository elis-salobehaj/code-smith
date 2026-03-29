# Repo Review Config Guide

This guide explains the repo-level `.codesmith.yaml` file: what it is, where it lives, how to write it, and what CodeSmith currently does with it.

## What This File Is

`.codesmith.yaml` is the repository-owned configuration file for CodeSmith review behavior.

It is intended to let a project define review rules close to the codebase instead of pushing every behavior change into deployment-level environment variables.

Typical use cases include:

- excluding generated or vendored files from review
- setting per-file review instructions
- changing severity thresholds for specific parts of the repo
- opting into future repo-level features such as linter integration, enhanced summaries, and organizational learning

## Current Status

CodeSmith currently supports the **configuration foundation** for this file:

- discovery at repo root
- YAML parsing
- strict Zod validation
- safe fallback to defaults when the file is missing or invalid
- glob validation and matching helpers

Important:

- the file is **loaded and validated today**
- most config-driven behavior is **not applied yet** in the review pipeline
- later CP1 phases will wire this file into diff filtering, prompt injection, and severity-aware verdict behavior

If you add `.codesmith.yaml` today, CodeSmith will validate it, but fields like `exclude`, `review_instructions`, and `file_rules` are still part of the forward contract rather than active review behavior.

## File Location And Discovery

CodeSmith looks for repo config at the **repository root** in this order:

1. `.codesmith.yaml`
2. `.codesmith.yml`
3. no file → use defaults

Only the first matching file is used.

## Authoring Standard

Treat `.codesmith.yaml` as a strict, versioned contract.

Recommended standard:

- keep the file at repo root only
- use YAML, not JSON or another format
- always include `version: 1`
- use the documented snake_case field names exactly
- prefer short, direct instruction text over long policy essays
- keep glob patterns repo-relative
- use comments to explain why a rule exists when the reason is not obvious
- do not try to define executable commands in the repo config

Validation rules enforced today:

- unknown keys are rejected
- malformed YAML falls back to defaults
- invalid enum values fall back to defaults through schema failure handling
- invalid glob patterns are rejected at load time
- executable-command-style fields are rejected because command execution remains deployment-owned

## Minimal Example

Use this when you want a valid file with the smallest supported surface:

```yaml
version: 1
```

This is enough to establish the file and opt into the current schema contract.

## Starter Example

This example shows the intended standard for a real repo-owned config file:

```yaml
version: 1

review_instructions: |
  This service values explicit error handling and backward-compatible API changes.
  Focus on correctness, validation, and operational safety.

file_rules:
  - pattern: "src/api/**"
    instructions: "Verify input validation, auth checks, and error responses."
  - pattern: "**/*.generated.*"
    skip: true
  - pattern: "**/*.test.ts"
    severity_threshold: high
    instructions: "Focus on broken coverage and incorrect assertions, not style."

exclude:
  - "vendor/**"
  - "dist/**"
  - "**/*.snap"

severity:
  minimum: low
  block_on: high

features:
  linter_integration: true
  enhanced_summary: true
  learning: false

linters:
  enabled: true
  profile: default
  severity_threshold: medium

output:
  max_findings: 6
  include_walkthrough: auto
  collapsible_details: true
```

## Field Reference

### Top-level fields

| Field | Required | Type | Default | Purpose | Current runtime effect |
|---|---|---|---|---|---|
| `version` | yes | literal `1` | none | Schema version gate | validated and required today |
| `review_instructions` | no | string | none | Global review guidance | parsed today, prompt consumer planned |
| `file_rules` | no | array | `[]` | Per-pattern review rules | parsed today, filtering/prompt consumers planned |
| `exclude` | no | array | `[]` | Always-skip file patterns | parsed today, diff filtering consumer planned |
| `severity` | no | object | see below | Repo severity defaults | parsed today, verdict consumer planned |
| `features` | no | object | see below | Per-repo feature toggles | parsed today, feature consumers planned |
| `linters` | no | object | see below | Named linter profile selection | parsed today, linter integration consumer planned |
| `output` | no | object | see below | Output shaping preferences | parsed today, output consumer planned |

### `file_rules`

Rules are evaluated in order. The intended contract is first-match-oriented review customization, even though later phases will define the exact runtime consumer behavior.

| Field | Required | Type | Default | Notes |
|---|---|---|---|---|
| `pattern` | yes | glob string | none | Must be a valid repo-relative glob |
| `severity_threshold` | no | `low | medium | high | critical` | none | Intended per-pattern severity override |
| `instructions` | no | string | none | Intended per-pattern review guidance |
| `skip` | no | boolean | none | Intended to skip matching files entirely |

### `severity`

| Field | Required | Type | Default |
|---|---|---|---|
| `minimum` | no | `low | medium | high | critical` | `low` |
| `block_on` | no | `low | medium | high | critical` | `high` |

### `features`

| Field | Required | Type | Default |
|---|---|---|---|
| `linter_integration` | no | boolean | `false` |
| `enhanced_summary` | no | boolean | `false` |
| `learning` | no | boolean | `false` |

### `linters`

| Field | Required | Type | Default | Notes |
|---|---|---|---|---|
| `enabled` | no | boolean | `false` | Enables repo opt-in when linter integration is wired |
| `profile` | no | string | none | References a deployment-owned profile name |
| `severity_threshold` | no | `low | medium | high | critical` | `medium` | Intended minimum included linter severity |

Important:

- this section may reference a **named profile only**
- the repo config may **not** define commands such as `eslint .`, `bunx biome check`, or shell snippets
- executable tooling remains controlled by the CodeSmith deployment, not by reviewed repositories

### `output`

| Field | Required | Type | Default |
|---|---|---|---|
| `max_findings` | no | positive integer | `6` |
| `include_walkthrough` | no | `auto | always | never` | `auto` |
| `collapsible_details` | no | boolean | `true` |

## Common Examples

These examples show the intended long-term shape of repo config for different repo types. Some fields are forward-looking until later CP1 phases land.

### Monorepo

```yaml
version: 1

exclude:
  - "packages/**/dist/**"
  - "packages/**/coverage/**"
  - "**/*.snap"

file_rules:
  - pattern: "packages/api/**"
    instructions: "Check API compatibility, auth, and request validation."
  - pattern: "packages/web/**"
    instructions: "Check state transitions, accessibility, and error handling."
  - pattern: "packages/shared/**"
    instructions: "Pay attention to cross-package compatibility and public API drift."
```

### TypeScript library

```yaml
version: 1

review_instructions: |
  This library prioritizes API stability, clear types, and backwards compatibility.

file_rules:
  - pattern: "src/**/*.ts"
    instructions: "Check exported types, error semantics, and breaking API changes."
  - pattern: "**/*.test.ts"
    severity_threshold: high
```

### Go service

```yaml
version: 1

review_instructions: |
  Focus on explicit error handling, context propagation, and safe concurrency.

file_rules:
  - pattern: "internal/api/**"
    instructions: "Review request validation, auth, and response-code correctness."
  - pattern: "proto/**"
    severity_threshold: critical
    instructions: "Check wire compatibility for all schema changes."
```

### Python data pipeline

```yaml
version: 1

review_instructions: |
  Focus on data correctness, schema drift, idempotency, and safe retry behavior.

exclude:
  - "**/__pycache__/**"
  - "data_snapshots/**"

file_rules:
  - pattern: "pipelines/**"
    instructions: "Check retry safety, side effects, and batch/window correctness."
  - pattern: "schemas/**"
    instructions: "Check backward compatibility and downstream consumer impact."
```

## Matching Rules And Glob Guidance

CodeSmith validates glob patterns at load time.

Patterns tested in the current compatibility matrix include:

- `**/*.ts`
- `!**/*.test.ts`
- `src/{api,agents}/**`
- `.hidden/**`
- `**/file.{js,ts}`
- `dir/`

Guidance:

- prefer explicit repo-relative paths such as `src/api/**`
- use `dist/**` or `vendor/**` for directories you always want excluded
- use `**/*.generated.*` or `**/*.snap` for generated artifacts
- trailing-slash directory patterns such as `dist/` are supported through normalized matching behavior

## What Not To Put In This File

Do not use `.codesmith.yaml` for:

- secrets
- access tokens
- deployment-specific credentials
- shell commands
- linter executable paths
- environment-specific hostnames or URLs unless CodeSmith later documents them as supported repo config

This file is for **repo-owned review policy**, not deployment ownership or secret management.

## Troubleshooting

### CodeSmith behaves as if no config exists

Check:

1. the file is named `.codesmith.yaml` or `.codesmith.yml`
2. the file is at repo root
3. the YAML parses cleanly
4. the file uses only documented keys

If parsing or validation fails, CodeSmith falls back to defaults rather than failing the review.

### A key is being ignored

Unknown keys are not accepted. A typo such as `reviewInstructions` or `severityMinimum` will cause schema validation failure and fallback.

Use the documented snake_case field names exactly.

### A glob pattern does not match the way you expect

Check that:

1. the pattern is repo-relative
2. the path form matches the reviewed file paths CodeSmith uses
3. the pattern is valid glob syntax

When in doubt, prefer simple patterns over clever ones.

### You expected review behavior to change immediately

Today, CodeSmith loads and validates repo config but does not yet consume most of it in the pipeline.

Current state:

- parser and schema: implemented
- diff filtering from `exclude` and `skip`: not yet wired
- prompt injection from `review_instructions` and `file_rules.instructions`: not yet wired
- severity-driven verdict behavior: not yet wired

See CP1 in [docs/plans/active/repo-review-config-plan.md](../plans/active/repo-review-config-plan.md) for the remaining phases.

### You tried to define a command under `linters`

That is intentionally rejected.

CodeSmith only accepts a named deployment-owned linter profile from the repo config. The reviewed repository is not allowed to decide what executable command the CodeSmith deployment runs.

## See Also

- [docs/context/CONFIGURATION.md](../context/CONFIGURATION.md) — schema and environment reference
- [docs/context/ARCHITECTURE.md](../context/ARCHITECTURE.md) — current runtime architecture and repo-config loading details
- [docs/plans/active/repo-review-config-plan.md](../plans/active/repo-review-config-plan.md) — CP1 implementation plan
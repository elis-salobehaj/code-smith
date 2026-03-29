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

CodeSmith currently supports the **configuration foundation and pipeline consumers** for this file:

- discovery at repo root
- YAML parsing
- strict Zod validation
- safe fallback to defaults when the file is missing or invalid
- glob validation and matching helpers
- diff filtering from `exclude` and `file_rules.skip`
- repo-level severity filtering and blocking verdict thresholds

Important:

- the file is **loaded and validated today**
- `exclude`, `file_rules.skip`, `severity.minimum`, and `severity.block_on` are **applied today** in the live review pipeline
- `review_instructions` and `file_rules.instructions` are **applied today** through agent prompt injection
- later CP1 and Crown phases add the remaining output/linter/feature-flag consumers

If you add `.codesmith.yaml` today, CodeSmith will already use it to skip excluded files, suppress findings below configured severity thresholds, and shape agent prompts with repo-owned review guidance. Feature toggles and later linter/output consumers are still part of the forward contract.

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
| `review_instructions` | no | string | none | Global review guidance | applied today in the context-agent prompt |
| `file_rules` | no | array | `[]` | Per-pattern review rules | `skip`, `severity_threshold`, and `instructions` are applied today |
| `exclude` | no | array | `[]` | Always-skip file patterns | applied today during pre-agent diff filtering |
| `severity` | no | object | see below | Repo severity defaults | `minimum` and `block_on` are applied today during reflection/verdict calculation |
| `features` | no | object | see below | Per-repo feature toggles | parsed today, feature consumers planned |
| `linters` | no | object | see below | Named linter profile selection | parsed today, linter integration consumer planned |
| `output` | no | object | see below | Output shaping preferences | parsed today, output consumer planned |

### `file_rules`

Rules are evaluated by matching glob pattern. Today, matching rules are used to skip files entirely, to raise effective severity thresholds for findings associated with those files, and to inject matching repo-owned review guidance into the investigator prompt.

| Field | Required | Type | Default | Notes |
|---|---|---|---|---|
| `pattern` | yes | glob string | none | Must be a valid repo-relative glob |
| `severity_threshold` | no | `low | medium | high | critical` | none | Applied today as a per-pattern minimum finding severity |
| `instructions` | no | string | none | Applied today as matching repo-owned investigator guidance |
| `skip` | no | boolean | none | Applied today to skip matching files entirely |

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

These examples show the supported config shape for different repo types. Fields under `features`, `linters`, and `output` remain forward-looking until later CP1 and Crown phases land.

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

Today, CodeSmith loads repo config and consumes filtering, severity controls, and prompt customization in the review flow. Later feature toggles and linter/output consumers are still pending.

Current state:

- parser and schema: implemented
- diff filtering from `exclude` and `skip`: implemented
- severity-driven finding filtering and verdict behavior: implemented
- prompt injection from `review_instructions` and `file_rules.instructions`: implemented
- feature toggles, linter-profile consumers, and output shaping: not yet wired

See the implemented CP1 record in [docs/plans/implemented/repo-review-config-plan.md](../plans/implemented/repo-review-config-plan.md) for the shipped foundation and the active CP1-SG follow-on plan for security hardening work.

### You tried to define a command under `linters`

That is intentionally rejected.

CodeSmith only accepts a named deployment-owned linter profile from the repo config. The reviewed repository is not allowed to decide what executable command the CodeSmith deployment runs.

## See Also

- [docs/context/CONFIGURATION.md](../context/CONFIGURATION.md) — schema and environment reference
- [docs/context/ARCHITECTURE.md](../context/ARCHITECTURE.md) — current runtime architecture and repo-config loading details
- [docs/plans/implemented/repo-review-config-plan.md](../plans/implemented/repo-review-config-plan.md) — implemented CP1 plan record
- [docs/plans/active/repo-config-security-gate-plan.md](../plans/active/repo-config-security-gate-plan.md) — active CP1-SG security hardening follow-on
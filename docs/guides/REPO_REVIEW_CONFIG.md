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
- bounded string, array, and raw-file size limits
- safe fallback to defaults when the file is missing or invalid
- trusted target-branch baseline governance for the current MR
- audit-only candidate source-branch config loading for the same MR
- deterministic screening and sanitization of unsafe unsealed string fields at load time
- separate top-level config-security MR publication when candidate findings exist
- optional SG3 no-tool semantic review of every non-empty candidate config when operators disable deterministic-only mode
- glob validation and matching helpers
- diff filtering from `exclude` and `file_rules.skip`
- repo-level severity filtering and blocking verdict thresholds

Important:

- the file is **loaded and validated today**
- oversized config or invalid shape still degrades to defaults rather than blocking the review
- the current MR is always governed by the trusted target-branch baseline config, never by the candidate config being introduced in that same MR
- unsafe prompt-bearing, scope-shaping, and selector strings are **sanitized today** before the config reaches prompt builders or later policy consumers
- `exclude`, `file_rules.skip`, `severity.minimum`, and `severity.block_on` are **applied today** in the live review pipeline
- `review_instructions` and `file_rules.instructions` are **applied today** through agent prompt injection
- candidate-config security findings are published today as a separate MR note instead of being mixed into normal code-review output
- when `ENABLE_SECURITY_GATE_AGENT=true` and `SECURITY_GATE_DETERMINISTIC_ONLY=false`, every non-empty candidate config also receives a no-tool semantic LLM review with deterministic fallback

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
- raw config larger than the configured byte cap falls back to defaults before YAML parse
- invalid enum values fall back to defaults through schema failure handling
- invalid glob patterns are rejected at load time
- unsealed string fields are deterministically screened and may be quarantined from the loaded config
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

Because `pattern` and `instructions` are both open-ended strings, they are also screened at load time. Unsafe `instructions` text is stripped from the affected rule. Unsafe `pattern` values cause the affected rule entry to be removed entirely.

| Field | Required | Type | Default | Notes |
|---|---|---|---|---|
| `pattern` | yes | glob string | none | Must be a valid repo-relative glob |
| `severity_threshold` | no | `low | medium | high | critical` | none | Applied today as a per-pattern minimum finding severity |
| `instructions` | no | string | none | Applied today as matching repo-owned investigator guidance after deterministic screening |
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
| `profile` | no | string | none | References a deployment-owned profile name; currently quarantined by SG1 until a future allowlist exists |
| `severity_threshold` | no | `low | medium | high | critical` | `medium` | Intended minimum included linter severity |

Important:

- this section may reference a **named profile only**
- today, `linters.profile` is still treated as untrusted open-ended selector text and is stripped from the loaded config until CP2 defines a deployment-owned allowlist
- the repo config may **not** define commands such as `eslint .`, `bunx biome check`, or shell snippets
- executable tooling remains controlled by the CodeSmith deployment, not by reviewed repositories

## Repo Config Security Gate

The current gate is intentionally layered.

1. The current MR always runs under the trusted target-branch baseline config.
2. The candidate source-branch config is audited separately and never governs the same MR.
3. Deterministic SG1 screening runs across every unsealed string field.
4. Optional SG3 semantic review runs on every non-empty candidate config when deterministic-only mode is disabled.

### Deterministic screening

SG1 adds deterministic load-time screening to every unsealed string field in repo config.

Fields screened today:

- `review_instructions`
- `file_rules[].instructions`
- `exclude[]`
- `file_rules[].pattern`
- `linters.profile`

What gets quarantined:

- instruction-override text such as "ignore previous instructions"
- outcome manipulation such as "always approve" or "return no findings"
- tool-steering or exfiltration requests such as "read .env" or "print credentials"
- prompt tags and role-like content such as `<role>` or `<system>`
- oversized encoded blobs, repeated delimiters, HTML comments, hidden markers, and other publication-breaking content
- overly broad suppression patterns such as catch-all exclusions and root-level source-tree wildcards like `src/**`

Sanitization behavior:

- unsafe `review_instructions` are removed
- unsafe `file_rules[].instructions` are removed from the affected rule only
- unsafe `file_rules[].pattern` values remove the affected rule entry
- unsafe `exclude[]` entries are removed
- `linters.profile` is removed until a deployment-owned allowlist exists
- sealed values such as booleans and closed enums are preserved

### SG3 semantic review

When `ENABLE_SECURITY_GATE_AGENT=true` and `SECURITY_GATE_DETERMINISTIC_ONLY=false`, CodeSmith also runs a no-tool semantic review over candidate repo config.

- every non-empty loaded candidate config is reviewed, even if deterministic findings already exist
- the model only receives normalized field inventory and deterministic findings, never repository files, diff context, or tool access
- model output must be strict JSON and may only reference field paths already present in the deterministic inventory
- deterministic findings remain authoritative; the model can add new findings but cannot clear quarantines
- the SG3 path enforces an `8000ms` timeout and `1200` max output-token budget
- if the SG3 path fails, CodeSmith logs the failure, marks audit metadata, and falls back to deterministic findings only

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

See the implemented CP1 record in [docs/plans/implemented/repo-review-config-plan.md](../plans/implemented/repo-review-config-plan.md) for the shipped foundation and the implemented CP1-SG plan for the delivered security hardening follow-on.

### You tried to define a command under `linters`

That is intentionally rejected.

CodeSmith only accepts a named deployment-owned linter profile from the repo config. The reviewed repository is not allowed to decide what executable command the CodeSmith deployment runs.

## See Also

- [docs/context/CONFIGURATION.md](../context/CONFIGURATION.md) — schema and environment reference
- [docs/context/ARCHITECTURE.md](../context/ARCHITECTURE.md) — current runtime architecture and repo-config loading details
- [docs/plans/implemented/repo-review-config-plan.md](../plans/implemented/repo-review-config-plan.md) — implemented CP1 plan record
- [docs/plans/implemented/repo-config-security-gate-plan.md](../plans/implemented/repo-config-security-gate-plan.md) — implemented CP1-SG security hardening follow-on
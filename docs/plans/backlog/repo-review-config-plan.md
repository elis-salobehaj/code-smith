---
title: "CP1 — Repo-Based Review Configuration (.gitgandalf.yaml)"
status: backlog
priority: high
estimated_hours: 24-36
dependencies: []
created: 2026-03-21
date_updated: 2026-03-28

related_files:
  - src/config.ts
  - src/api/pipeline.ts
  - src/agents/prompt-loader.ts
  - src/agents/context-agent.ts
  - src/agents/investigator-agent.ts
  - src/agents/reflection-agent.ts
  - src/agents/prompts/system-prompts.yaml
  - src/context/repo-manager.ts
  - .env.example
  - docs/guides/REPO_REVIEW_CONFIG.md
  - docs/context/ARCHITECTURE.md
  - docs/context/CONFIGURATION.md
  - docs/context/WORKFLOWS.md
  - docs/README.md

tags:
  - config
  - customization
  - crown-plan
  - CP1

completion:
  - "# Phase C1 — Config Schema & Parser"
  - [x] C1.1 Define `.gitgandalf.yaml` Zod schema with all supported sections
  - [x] C1.2 Implement config discovery and loading from cloned repo path
  - [x] C1.3 Add fallback defaults when no config file exists
  - [x] C1.4 Add Zod validation with helpful error messages for invalid configs
  - [x] C1.5 Unit tests for schema validation, missing file, malformed YAML, partial configs
  - [x] C1.6 Update CONFIGURATION.md and ARCHITECTURE.md
  - [x] Remediation complete — see `docs/plans/review-reports/c1-review-2026-03-28-q7m2.md`
  - [x] Re-review remediation complete — see `docs/plans/review-reports/c1-review-2026-03-28-v4n8.md`
  - "# Phase C2 — Pipeline Integration"
  - [ ] C2.1 Load repo config after clone/update in pipeline.ts
  - [ ] C2.2 Attach parsed config to ReviewState
  - [ ] C2.3 Apply file exclusion patterns to diff filtering (pre-agent)
  - [ ] C2.4 Apply draft/skip rules from repo config
  - [ ] C2.5 Unit tests for pipeline config loading and diff filtering
  - [ ] C2.6 Update WORKFLOWS.md
  - "# Phase C3 — Prompt Injection"
  - [ ] C3.1 Extend prompt-loader to accept optional custom instructions
  - [ ] C3.2 Inject per-file-pattern rules into investigator agent prompt
  - [ ] C3.3 Inject global custom review instructions into context agent prompt
  - [ ] C3.4 Inject severity override rules into reflection agent prompt
  - [ ] C3.5 Unit tests for prompt injection with various config combinations
  - [ ] C3.6 Update ARCHITECTURE.md prompt-loading section
  - "# Phase C4 — Docs, Validation & Audit"
  - [x] C4.1 Create .gitgandalf.yaml reference documentation with examples
  - [ ] C4.2 Add sample .gitgandalf.yaml to repo root as a dogfooding example
  - [ ] C4.3 Update GETTING_STARTED.md with config setup instructions
  - [ ] C4.4 Update docs/README.md
  - [ ] C4.5 Run review-plan-phase audit
---

# CP1 — Repo-Based Review Configuration (.gitgandalf.yaml)

## Executive Summary

Git Gandalf currently has no repo-level configuration. All behavior is controlled by environment variables on the Git Gandalf instance. This means every project reviewed by the same instance gets identical treatment — no custom rules, no file exclusions, no severity overrides, no per-team customization.

Both competitors offer repo-based config: GitLab Duo uses `.gitlab/duo/mr-review-instructions.yaml` with per-file glob patterns, and CodeRabbit uses `.coderabbit.yaml` with path-based and AST-based rules plus organizational learnings.

This plan introduces `.gitgandalf.yaml` — a repo-level configuration file that lets teams customize Git Gandalf's behavior without redeployment. It is the foundational plan: CP2 (linters), CP3 (learning), and CP4 (output) all depend on this config system.

## Config Schema Design

### File Location

Git Gandalf discovers config in this order (first match wins):
1. `.gitgandalf.yaml` at repo root
2. `.gitgandalf.yml` at repo root
3. No file → use defaults

### Full Schema

```yaml
# .gitgandalf.yaml — Git Gandalf repo-level configuration
version: 1

# Global review instructions injected into every review
review_instructions: |
  This is a Go microservice following clean architecture.
  Pay special attention to error handling patterns — we use
  explicit error returns, no panic/recover.
  Our API contracts are defined in proto/ — check backward compatibility.

# Per-file-pattern rules (glob-based, evaluated in order, first match wins)
file_rules:
  - pattern: "**/*.test.ts"
    severity_threshold: high          # Only report high+ findings for test files
    instructions: "Focus on test correctness and coverage gaps, not style."
  - pattern: "**/*.generated.*"
    skip: true                        # Skip generated files entirely
  - pattern: "proto/**"
    instructions: "Check backward compatibility of all field changes."
    severity_threshold: critical      # Only block on critical issues in proto files
  - pattern: "src/api/**"
    instructions: "Verify input validation, auth checks, and error responses."

# File/directory exclusion patterns (always skipped, no review)
exclude:
  - "vendor/**"
  - "**/*.min.js"
  - "dist/**"
  - "**/*.lock"
  - "**/*.snap"

# Severity configuration
severity:
  minimum: low                        # Minimum severity to report (low|medium|high|critical)
  block_on: high                      # Minimum severity to trigger REQUEST_CHANGES verdict

# Feature flags (opt-in/out per repo)
features:
  linter_integration: true            # Enable linter pre-processing (requires CP2)
  enhanced_summary: true              # Enable smart MR summary (requires CP4)
  learning: true                      # Enable learning feedback loop (requires CP3)

# Linter configuration (used by CP2)
# Repo config may select a named profile, but executable commands are owned by
# the Git Gandalf deployment and never defined in the reviewed repository.
linters:
  enabled: true
  profile: default                    # Named instance-owned profile (e.g. default, strict)
  severity_threshold: medium          # Minimum linter severity to include

# Output configuration (used by CP4)
output:
  max_findings: 6                     # Maximum findings per review (default: 6)
  include_walkthrough: auto           # auto | always | never
  collapsible_details: true           # Use collapsible sections in summary
```

### Zod Schema

The config will be validated with Zod at load time. Key design decisions:

- **All fields optional** — bare `version: 1` is a valid config
- **Unknown keys rejected** — strict parsing catches typos early
- **Glob patterns validated** — invalid glob syntax fails at parse time, not review time
- **Version field required** — enables schema evolution without breaking existing configs

## Technology Decisions

| Concern | Choice | Rationale |
|---|---|---|
| YAML parsing | `Bun.YAML.parse()` | Already used for system-prompts.yaml; Bun-native, zero deps |
| Schema validation | Zod `.strict()` | Consistent with all other validation in the codebase |
| Glob matching | `Bun.Glob` first, `picomatch` only if required | Prefer Bun-native behavior and add dependency weight only if the required pattern matrix is not satisfied |
| Config location | Repo root after clone | Config is read from the cloned repo, not from a separate API call |
| Linter extensibility | Named instance-owned profiles | Repo authors can opt into allowlisted profiles without gaining command-execution power |

## Current State → Target State

| Aspect | Current | Target |
|---|---|---|
| Repo config | None | `.gitgandalf.yaml` with full Zod-validated schema |
| File exclusions | None (review all changed files) | Glob-based exclusion patterns |
| Custom instructions | None (static prompts only) | Per-file-pattern and global custom instructions injected into agent prompts |
| Severity control | Fixed (report all findings) | Configurable minimum severity and blocking threshold |
| Feature flags | Instance-level env vars only | Per-repo feature toggles |
| Linter selection | None | Named profile selection only; no repo-defined executable commands |

## Phased Implementation

### Phase C1 — Config Schema & Parser

**Goal:** Define the config schema, implement file discovery and parsing, and handle missing/invalid configs gracefully.

**C1.1** — Create `src/config/repo-config.ts`:
- Define `RepoConfigSchema` as a Zod schema matching the YAML structure above
- Export `type RepoConfig = z.infer<typeof RepoConfigSchema>`
- All fields optional except `version`
- Restrict linter configuration to booleans, thresholds, and named profile references only
- Export `DEFAULT_REPO_CONFIG` with sensible defaults

**C1.2** — Create `src/config/repo-config-loader.ts`:
- `loadRepoConfig(repoPath: string): Promise<RepoConfig>`
- Discovery order: `.gitgandalf.yaml`, `.gitgandalf.yml`
- Use `Bun.file(path).text()` for zero-copy reads
- Parse with `Bun.YAML.parse()`
- Validate with `RepoConfigSchema.parse()`

**C1.3** — Default handling:
- When no config file exists, return `DEFAULT_REPO_CONFIG` (all defaults)
- Log at `info` level whether config was found or defaults used

**C1.4** — Error handling:
- Invalid YAML → log `warn` with file path and error, fall back to defaults (don't crash review)
- Schema validation failure → log `warn` with specific Zod issues, fall back to defaults
- Philosophy: bad config should degrade to default behavior, never block a review

**C1.5** — Tests:
- Valid full config parsing
- Minimal config (`version: 1` only)
- Missing config file → defaults
- Malformed YAML → defaults with warning
- Invalid schema values → defaults with warning (e.g., `severity.minimum: "banana"`)
- Unknown keys → rejected (strict mode)
- **Explicit glob compatibility test matrix (review-driven O3):** Test the following patterns against `Bun.Glob` to establish the compatibility baseline:
  - `**/*.ts` (recursive match)
  - `!**/*.test.ts` (negation)
  - `src/{api,agents}/**` (brace expansion)
  - `.hidden/**` (dot-file matching)
  - `**/file.{js,ts}` (brace expansion in filename)
  - `dir/` (trailing slash directory match)
  - If any pattern fails under `Bun.Glob`, document the gap and add `picomatch` as a fallback at that point
- Rejection of any repo-defined executable command fields

**C1.6** — Update CONFIGURATION.md: add `.gitgandalf.yaml` section with schema reference.

### Phase C2 — Pipeline Integration

**Goal:** Load repo config at the right point in the pipeline and apply pre-agent filtering.

**C2.1** — In `src/api/pipeline.ts`, after repo clone/update (line ~183):
- Call `loadRepoConfig(repoPath)`
- Attach to a new `repoConfig` field on the pipeline context

**C2.2** — Extend `ReviewState` in `src/agents/state.ts`:
- Add `repoConfig: RepoConfig` field
- Pass through to all agent calls

**C2.3** — Apply file exclusions:
- After computing `analysisDiffFiles`, filter out files matching `exclude` patterns
- Filter out files matching any `file_rules` entry with `skip: true`
- Use `Bun.Glob` by default; only introduce `picomatch` if a documented pattern requirement fails

**C2.4** — Apply severity overrides:
- Store the per-file severity rules in ReviewState for access during reflection agent
- Apply `severity.block_on` threshold in verdict calculation

**C2.5** — Tests:
- Pipeline with config loaded → correct ReviewState
- Pipeline with exclusion patterns → filtered diff files
- Pipeline with no config → default behavior unchanged
- Pipeline with skip rules → files excluded

**C2.6** — Update WORKFLOWS.md: add config loading step to pipeline flow description.

### Phase C3 — Prompt Injection

**Goal:** Inject custom review instructions into agent prompts based on repo config.

**C3.1** — Extend `src/agents/prompt-loader.ts`:
- Add `renderPromptWithCustomRules(promptKey, customInstructions?)` function
- Custom instructions are appended in a `<custom_instructions>` XML section after the standard prompt
- When no custom instructions exist, prompt is identical to today

**C3.2** — Investigator agent injection:
- For each file being reviewed, find matching `file_rules` entries
- Concatenate matching `instructions` into a per-file context block
- Inject as a `<repo_review_rules>` section in the investigator prompt
- Example: "For files matching `src/api/**`: Verify input validation, auth checks, and error responses."

**C3.3** — Context agent injection:
- Inject `review_instructions` (global) into the context agent's user prompt
- This helps shape intent analysis and risk hypotheses

**C3.4** — Reflection agent injection:
- Inject `severity.minimum` and `severity.block_on` as explicit filtering rules
- "Discard findings below {minimum} severity. Only set REQUEST_CHANGES for findings at {block_on} or above."

**C3.5** — Tests:
- Prompt rendered with no custom instructions → unchanged
- Prompt rendered with global instructions → appended section
- Prompt rendered with file-pattern rules → per-file context injected
- Prompt rendered with severity overrides → reflection agent rules modified
- Multiple matching file patterns → all matching instructions included

**C3.6** — Update ARCHITECTURE.md: document prompt injection flow.

### Phase C4 — Docs, Validation & Audit

**Goal:** Complete documentation and validate the full config system.

**C4.1** — Create `docs/guides/REPO_REVIEW_CONFIG.md`:
- Full reference for `.gitgandalf.yaml`
- Example configs for common scenarios (monorepo, Go service, TypeScript library, Python data pipeline)
- Field-by-field documentation
- Explicit note that repo config cannot define commands and may only reference allowlisted instance profiles
- Troubleshooting (config not loading, patterns not matching)

**C4.2** — Add `.gitgandalf.yaml` to the Git Gandalf repo itself (dogfooding):
- Exclude `node_modules/`, `dist/`, lock files
- Set review instructions for the codebase conventions

**C4.3** — Update `docs/guides/GETTING_STARTED.md`:
- Add config section after webhook setup
- Link to REPO_REVIEW_CONFIG.md reference

**C4.4** — Update `docs/README.md`:
- Add plan status entry
- Update current state summary

**C4.5** — Run `review-plan-phase` audit.

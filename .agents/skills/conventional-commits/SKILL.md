---
name: conventional-commits
description: >
  Conventional Commits standard for CodeSmith. Use when creating a git commit
  message, reviewing a commit message, or preparing a set of changes to commit.
  Produces a correctly structured commit message with type, optional scope, subject,
  body, and footer following https://www.conventionalcommits.org/en/v1.0.0/
argument-hint: 'Describe the changes to commit, or paste the diff/file list to summarize.'
license: Apache-2.0
---

# Conventional Commits

Use this skill whenever composing a commit message for CodeSmith. The commit
message must follow the [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/)
specification so the history is machine-readable, changelogs are automatable, and
the intent of every change is immediately clear.

## Outcome

Produce a complete, standards-compliant commit message ready to pass to `git commit -m`
or `git commit` that:
- uses the correct type and optional scope
- has a concise, imperative subject line ≤ 72 characters
- includes a body paragraph when the change is non-trivial
- includes a `BREAKING CHANGE:` footer when applicable
- calls out co-authors or issue references in the footer when relevant

## Commit Message Format

```
<type>[optional scope]: <subject>

[optional body]

[optional footer(s)]
```

### Types

| Type | When to use |
|---|---|
| `feat` | A new feature or capability visible to users or agents |
| `fix` | A bug fix |
| `docs` | Documentation-only changes |
| `style` | Formatting, whitespace, or code style with no behavior change |
| `refactor` | Code restructuring with no feature addition or bug fix |
| `test` | Adding or correcting tests with no production code change |
| `chore` | Tooling, configuration, dependency, or CI changes |
| `perf` | Performance improvement |
| `revert` | Reverting a prior commit |
| `build` | Changes to build system or external dependencies |

### Scopes for CodeSmith

Use scopes to narrow the area of change. Preferred scopes for this repo:

| Scope | Area |
|---|---|
| `skills` | Changes to `.agents/skills/` |
| `agents` | Changes to `src/agents/` |
| `api` | Changes to `src/api/` |
| `config` | Changes to `src/config.ts` or env/config files |
| `gitlab` | Changes to `src/gitlab-client/` or `src/publisher/` |
| `context` | Changes to `src/context/` (repo cloner, tools) |
| `docs` | Changes to `docs/` tree |
| `ci` | CI/CD workflow changes |
| `deps` | Dependency additions or upgrades |

Omit scope for cross-cutting changes that span multiple areas.

### Subject Line Rules

- Use the **imperative mood**: "add skill" not "added skill" or "adds skill"
- Do **not** capitalize the first letter
- Do **not** end with a period
- Keep to ≤ 72 characters
- Summarize *what* changed and *why* in one phrase if possible

### Body

- Separate from subject with a blank line
- Wrap at ≤ 100 characters per line
- Explain *what* and *why*, not *how* — the diff shows how
- Use bullet points for multi-part changes
- Required when the subject line alone is ambiguous

### Footer

- `BREAKING CHANGE: <description>` — required for any breaking API or behavior change;
  triggers a major version bump in semver tooling
- `Fixes #<issue>`, `Closes #<issue>` — links to resolved issues
- `Co-authored-by: Name <email>` — for pair work or agent attribution

## Procedure

1. Identify the primary intent of the change set.
   Ask: is this introducing new behavior (`feat`), fixing broken behavior (`fix`), or
   changing documentation/tooling/structure without affecting runtime behavior?

2. Pick the type and scope.
   Use the tables above. When changes span multiple types, pick the highest-impact type
   for the subject and explain the rest in the body.

3. Write the subject line.
   Imperative, ≤ 72 chars, no period, summarizes the change.

4. Write the body if needed.
   Multi-area changes, non-obvious rationale, or large diffs warrant a body.
   Briefly list what each area changed and why.

5. Add footers.
   Add `BREAKING CHANGE:` if any public interface changed incompatibly.
   Add issue/PR references if applicable.

6. Validate before committing.
   - Subject line starts with a valid type
   - Subject line ≤ 72 characters
   - Blank line between subject and body
   - No trailing punctuation on the subject
   - Breaking change documented in footer

## Decision Rules

- If the change adds a new skill, CLI flag, API route, or agent behavior → `feat`
- If the change fixes a defect or config error → `fix`
- If the change only affects markdown documentation under `docs/` → `docs`
- If the change fixes formatting under Biome with no behavior change → `style`
- If the change touches multiple types, use the type of the most impactful change and
  document the others in the body
- If the commit touches both a source file and its tests together as one atomic unit → `feat` or `fix` (not `test`)
- If a breaking change exists, it must appear as a `BREAKING CHANGE:` footer regardless of type

## Examples

Single-area change:
```
feat(skills): add review-plan-phase audit skill
```

Multi-area change with body:
```
feat(skills): add agent workflow skills and fix biome config

- add review-plan-phase: principal-engineer audit workflow for plan-driven phases
- add plan-phase-remediation: post-audit ordered fix planning skill
- expand bun-project-conventions: add Biome, Zod, and TypeScript compliance steps
- fix biome.json: correct indentStyle, lineWidth, and missing lint rules
- add AGENTS.md plan completion gate referencing the new skills
```

Breaking change:
```
feat(api)!: rename webhook endpoint path

BREAKING CHANGE: /api/v1/webhook is now /api/v1/webhooks/gitlab.
Update GitLab webhook URL in project settings before deploying.
```

Docs-only change:
```
docs: expand docs/README.md navigation index and update placeholder stubs
```

## Preferred Prompts

- Write a conventional commit message for these changes: [paste diff or file list]
- Review this commit message for conventional commits compliance.
- Compose a commit for all staged changes following conventional commits.
- What type and scope should I use for a commit that changes X?

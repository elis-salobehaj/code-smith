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

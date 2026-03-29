import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { AgentToolDefinition } from "../../agents/protocol";
import { assertInsideRepo } from "./shared";

// ---------------------------------------------------------------------------
// Tool definition (CodeSmith internal tool schema)
// ---------------------------------------------------------------------------

export const toolDefinition: AgentToolDefinition = {
  name: "get_directory_structure",
  description:
    "Get a tree-style directory listing of the repository (max depth 3). Common build and tooling directories (.git, node_modules, dist, etc.) are omitted automatically.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Optional sub-directory path relative to the repository root. Defaults to the repository root.",
      },
    },
    required: [],
  },
};

// ---------------------------------------------------------------------------
// Input validation schema — used by executeTool before calling getDirectoryStructure
// ---------------------------------------------------------------------------

export const inputSchema = z.object({ path: z.string().optional() });

// ---------------------------------------------------------------------------
// Directory names skipped at every depth level during tree traversal
// ---------------------------------------------------------------------------

export const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  ".nyc_output",
  ".cache",
  "vendor",
  "target",
]);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Return a tree-style directory listing for `subPath` inside `repoPath`.
 * Maximum recursion depth is 3. Common tooling directories are omitted.
 *
 * Security: `subPath` is resolved against `repoPath` before I/O.
 * Any path that escapes the sandbox throws "Path traversal attempt blocked".
 */
export async function getDirectoryStructure(repoPath: string, subPath = "."): Promise<string> {
  assertInsideRepo(repoPath, subPath);
  const resolved = resolve(repoPath, subPath);
  return buildTree(resolved, 0);
}

async function buildTree(dirPath: string, depth: number): Promise<string> {
  if (depth >= 3) return "";

  let entries: Dirent<string>[];
  try {
    entries = (await readdir(dirPath, { withFileTypes: true })) as Dirent<string>[];
  } catch {
    return "";
  }

  // Directories first, then files; both groups sorted alphabetically.
  entries.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    return aDir !== bDir ? aDir - bDir : a.name.localeCompare(b.name);
  });

  const pad = "  ".repeat(depth);
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      lines.push(`${pad}${entry.name}/`);
      const sub = await buildTree(join(dirPath, entry.name), depth + 1);
      if (sub) lines.push(sub);
    } else {
      lines.push(`${pad}${entry.name}`);
    }
  }

  return lines.join("\n");
}

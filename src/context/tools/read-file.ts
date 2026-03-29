import { resolve } from "node:path";
import { z } from "zod";
import type { AgentToolDefinition } from "../../agents/protocol";
import { assertInsideRepo } from "./shared";

// ---------------------------------------------------------------------------
// Tool definition (CodeSmith internal tool schema)
// ---------------------------------------------------------------------------

export const toolDefinition: AgentToolDefinition = {
  name: "read_file",
  description:
    "Read a file's contents from the cloned repository. Returns up to 500 lines with 1-based line numbers prepended. The path must be relative to the repository root.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Path to the file relative to the repository root (e.g. 'src/api/router.ts').",
      },
    },
    required: ["path"],
  },
};

// ---------------------------------------------------------------------------
// Input validation schema — used by executeTool before calling readFile
// ---------------------------------------------------------------------------

export const inputSchema = z.object({ path: z.string() });

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Read `filePath` (relative to `repoPath`), returning up to 500 lines with
 * 1-based line numbers prepended to each line.
 *
 * Security: `filePath` is resolved against `repoPath` before I/O.
 * Any path that escapes the sandbox throws "Path traversal attempt blocked".
 */
export async function readFile(repoPath: string, filePath: string): Promise<string> {
  assertInsideRepo(repoPath, filePath);
  const resolved = resolve(repoPath, filePath);
  const content = await Bun.file(resolved).text();
  return content
    .split("\n")
    .slice(0, 500)
    .map((line, i) => `${i + 1}: ${line}`)
    .join("\n");
}

import { z } from "zod";
import type { AgentToolDefinition } from "../../agents/protocol";
import { config } from "../../config";
import type { SearchResult } from "./shared";

// ---------------------------------------------------------------------------
// Tool definition (CodeSmith internal tool schema)
// The cap is injected from config so the LLM sees the actual runtime limit.
// ---------------------------------------------------------------------------

export const toolDefinition: AgentToolDefinition = {
  name: "search_codebase",
  description: `Search the repository using ripgrep. Returns matching file paths, 1-based line numbers, and the matching line text. Capped at ${config.MAX_SEARCH_RESULTS} results across all files.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The search query (plain text or regex pattern passed to ripgrep).",
      },
      file_glob: {
        type: "string",
        description:
          "Optional glob pattern to restrict the search to specific file types (e.g. '*.ts', '**/*.json'). Defaults to all files.",
      },
    },
    required: ["query"],
  },
};

// ---------------------------------------------------------------------------
// Input validation schema — used by executeTool before calling searchCodebase
// ---------------------------------------------------------------------------

export const inputSchema = z.object({ query: z.string(), file_glob: z.string().optional() });

// ---------------------------------------------------------------------------
// Ripgrep NDJSON parser — Zod-validated per line; malformed lines skipped
// ---------------------------------------------------------------------------

const rgMatchSchema = z.object({
  type: z.literal("match"),
  data: z.object({
    path: z.object({ text: z.string() }),
    line_number: z.number(),
    lines: z.object({ text: z.string() }),
  }),
});

function parseRipgrepJson(output: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  for (const raw of output.split("\n")) {
    if (results.length >= limit) break;
    if (!raw.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // skip malformed NDJSON lines
    }

    const match = rgMatchSchema.safeParse(parsed);
    if (!match.success) continue;

    const { data } = match.data;
    results.push({
      file: data.path.text,
      line: data.line_number,
      text: data.lines.text.trimEnd(),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Search `repoPath` using ripgrep. Returns up to `config.MAX_SEARCH_RESULTS`
 * results, each with the relative file path, 1-based line number, and
 * matching line text.
 *
 * When ripgrep is not installed or there are no matches, returns [].
 */
export async function searchCodebase(repoPath: string, query: string, fileGlob = "*"): Promise<SearchResult[]> {
  const proc = Bun.spawn(["rg", "--json", "-g", fileGlob, query, "."], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;
  const output = await new Response(proc.stdout).text();
  return parseRipgrepJson(output, config.MAX_SEARCH_RESULTS);
}

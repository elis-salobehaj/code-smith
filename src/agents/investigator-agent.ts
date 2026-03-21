import { z } from "zod";
import { config } from "../config";
import { executeTool, TOOL_DEFINITIONS } from "../context/tools";
import { chatCompletion } from "./llm-client";
import { loadAgentPrompt } from "./prompt-loader";
import { type AgentMessage, textMessage, toolCallBlocks } from "./protocol";
import { type Finding, findingSchema, type ReviewState } from "./state";

// ---------------------------------------------------------------------------
// Response-parsing schemas
// ---------------------------------------------------------------------------

const rawFindingsSchema = z.array(findingSchema);
const toolInputSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the initial investigator user prompt from context-agent output.
 */
export function buildInvestigatorPrompt(state: ReviewState): string {
  const MAX_HUNK_CHARS = 6_000;

  const hunkSummary =
    state.diffHunks.length === 0
      ? "(no structured hunks available)"
      : state.diffHunks
          .map((h) => {
            const addedStr = h.addedLines.map((l) => `+ (L${l.lineNumber}) ${l.content}`).join("\n");
            const removedStr = h.removedLines.map((l) => `- (removed) ${l.content}`).join("\n");
            const parts = [addedStr, removedStr].filter(Boolean).join("\n");
            return `FILE: ${h.file} | HUNK ${h.hunkIndex} | new lines ${h.newLineStart}\u2013${h.newLineEnd}\n${h.header}\n${parts}`;
          })
          .join("\n\n")
          .slice(0, MAX_HUNK_CHARS);

  const hypotheses = state.riskAreas.length
    ? state.riskAreas.map((h, i) => `${i + 1}. ${h}`).join("\n")
    : "(none — do a general review)";

  return [
    `## MR Intent`,
    state.mrIntent,
    ``,
    `## Change Categories`,
    state.changeCategories.join(", ") || "(general)",
    ``,
    `## Risk Hypotheses to Investigate`,
    hypotheses,
    ``,
    `## Diff Hunks (${state.diffHunks.length} total, capped at ${MAX_HUNK_CHARS} chars)`,
    hunkSummary,
  ].join("\n");
}

/**
 * Extract the findings JSON array from the final assistant message.
 *
 * Looks for a JSON array in the last text block of the message history.
 * Returns [] if no valid findings are found (safe default).
 */
export function extractFindings(messages: AgentMessage[]): Finding[] {
  // Walk assistant messages from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    for (const block of msg.content) {
      if (block.type !== "text") continue;

      const text = block.text.trim();
      // Try to extract a JSON array — accept both raw JSON and ```json fenced blocks
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\[[\s\S]*\])/);
      if (!jsonMatch) continue;

      const candidate = jsonMatch[1]?.trim();
      if (!candidate) continue;

      try {
        const parsed = JSON.parse(candidate);
        const result = rawFindingsSchema.safeParse(parsed);
        if (result.success) return result.data;
      } catch {
        // Not valid JSON — try next block
      }
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------

export async function investigatorLoop(state: ReviewState): Promise<ReviewState> {
  const messages: AgentMessage[] = [textMessage("user", buildInvestigatorPrompt(state))];

  let iterations = 0;

  while (iterations < config.MAX_TOOL_ITERATIONS) {
    const response = await chatCompletion(loadAgentPrompt("investigator_agent"), messages, TOOL_DEFINITIONS);

    // Append the assistant turn to history
    messages.push(response.message);

    const toolUses = toolCallBlocks(response.message);

    // If the agent stopped calling tools, the investigation is complete
    if (toolUses.length === 0) break;

    // Execute all requested tools in parallel and append results
    const toolResults = await Promise.all(
      toolUses.map(async (toolUse) => {
        try {
          return {
            type: "tool_result" as const,
            toolCallId: toolUse.id,
            output: await executeTool(state.repoPath, toolUse.name, toolInputSchema.parse(toolUse.input)),
          };
        } catch (error) {
          return {
            type: "tool_result" as const,
            toolCallId: toolUse.id,
            output: error instanceof Error ? error.message : String(error),
            isError: true,
          };
        }
      }),
    );

    messages.push({ role: "user", content: toolResults });
    iterations++;
  }

  return {
    ...state,
    rawFindings: extractFindings(messages),
    messages,
  };
}

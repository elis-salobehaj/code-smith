import { z } from "zod";
import { chatCompletion } from "./llm-client";
import { loadAgentPrompt } from "./prompt-loader";
import { type AgentMessage, firstTextBlock, textMessage } from "./protocol";
import type { ReviewState } from "./state";

// ---------------------------------------------------------------------------
// Zod schema for LLM output validation
// ---------------------------------------------------------------------------

const contextResponseSchema = z.object({
  intent: z.string().min(1),
  categories: z.array(z.string()),
  riskHypotheses: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the user-facing prompt from the current review state.
 * Caps the diff at 8000 characters to stay within token budgets.
 */
export function buildContextPrompt(state: ReviewState): string {
  const MAX_DIFF_CHARS = 8_000;

  const diffSummary = state.diffFiles
    .map((f) => {
      const header = `--- ${f.oldPath}\n+++ ${f.newPath}`;
      return `${header}\n${f.diff}`;
    })
    .join("\n\n")
    .slice(0, MAX_DIFF_CHARS);

  const ticketSection =
    state.linkedTickets.length > 0
      ? [
          "",
          "## Linked Jira Tickets",
          ...state.linkedTickets.map((t) => {
            const lines = [`**${t.key}** — ${t.summary}`, `- Status: ${t.status}  Type: ${t.issueType}`];
            if (t.priority) lines.push(`- Priority: ${t.priority}`);
            if (t.assignee) lines.push(`- Assignee: ${t.assignee}`);
            if (t.description) lines.push(`- Description: ${t.description.slice(0, 400)}`);
            if (t.acceptanceCriteria) lines.push(`- Acceptance Criteria: ${t.acceptanceCriteria.slice(0, 400)}`);
            return lines.join("\n");
          }),
        ]
      : [];

  return [
    `## Merge Request`,
    `**Title**: ${state.mrDetails.title}`,
    `**Description**: ${state.mrDetails.description ?? "(none)"}`,
    `**Author**: ${state.mrDetails.authorUsername}`,
    `**Source branch**: ${state.mrDetails.sourceBranch} → ${state.mrDetails.targetBranch}`,
    `**Files changed**: ${state.diffFiles.length}`,
    ...ticketSection,
    ``,
    `## Diff`,
    diffSummary,
  ].join("\n");
}

/**
 * Extract and Zod-validate the JSON payload from the LLM response.
 * Throws if the response cannot be parsed or does not match the schema.
 */
export function parseContextResponse(response: AgentMessage): {
  intent: string;
  categories: string[];
  riskHypotheses: string[];
} {
  const textBlock = firstTextBlock(response);
  if (!textBlock) {
    throw new Error("Context agent returned no text block");
  }

  // Strip optional ```json ... ``` code fence the LLM sometimes wraps output in
  const stripped = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    throw new Error(`Context agent returned unparseable JSON:\n${textBlock.text}`);
  }

  return contextResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------

export async function contextAgent(state: ReviewState): Promise<ReviewState> {
  const response = await chatCompletion(loadAgentPrompt("context_agent"), [
    textMessage("user", buildContextPrompt(state)),
  ]);

  const parsed = parseContextResponse(response.message);

  return {
    ...state,
    mrIntent: parsed.intent,
    changeCategories: parsed.categories,
    riskAreas: parsed.riskHypotheses,
  };
}

import { z } from "zod";
import {
  compareRepoSeverityLevels,
  type RepoSeverityLevel,
  resolveFindingSeverityThreshold,
} from "../config/repo-config";
import { chatCompletion } from "./llm-client";
import { loadAgentPrompt } from "./prompt-loader";
import { type AgentMessage, firstTextBlock, textMessage } from "./protocol";
import { type Finding, findingSchema, type ReviewState } from "./state";

// ---------------------------------------------------------------------------
// Zod schema for LLM output validation
// ---------------------------------------------------------------------------

const reflectionResponseSchema = z.object({
  verifiedFindings: z.array(findingSchema),
  summaryVerdict: z.enum(["APPROVE", "REQUEST_CHANGES", "NEEDS_DISCUSSION"]),
  needsReinvestigation: z.boolean(),
  reinvestigationReason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the user-facing prompt from the raw findings and MR context.
 */
export function buildReflectionPrompt(state: ReviewState): string {
  const findingsList = state.rawFindings.length === 0 ? "(none)" : JSON.stringify(state.rawFindings, null, 2);

  return [
    `## MR Intent`,
    state.mrIntent,
    ``,
    `## Raw Findings from Investigation (${state.rawFindings.length} total)`,
    findingsList,
  ].join("\n");
}

/**
 * Extract and Zod-validate the JSON payload from the reflection response.
 * Throws if the response cannot be parsed or does not match the schema.
 */
export function parseReflectionResponse(response: AgentMessage): {
  verifiedFindings: z.infer<typeof findingSchema>[];
  summaryVerdict: "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION";
  needsReinvestigation: boolean;
  reinvestigationReason?: string;
} {
  const textBlock = firstTextBlock(response);
  if (!textBlock) {
    throw new Error("Reflection agent returned no text block");
  }

  const text = textBlock.text.trim();
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const candidate = jsonMatch?.[1]?.trim() ?? text;

  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    throw new Error(`Reflection agent returned unparseable JSON:\n${textBlock.text}`);
  }

  return reflectionResponseSchema.parse(raw);
}

function meetsSeverityThreshold(finding: Finding, threshold: RepoSeverityLevel): boolean {
  return compareRepoSeverityLevels(finding.riskLevel, threshold) >= 0;
}

export function filterFindingsForRepoConfig(findings: Finding[], state: ReviewState): Finding[] {
  return findings.filter((finding) => {
    const threshold = resolveFindingSeverityThreshold(state.repoConfig, finding.file);
    return meetsSeverityThreshold(finding, threshold);
  });
}

export function deriveRepoConfigVerdict(findings: Finding[], state: ReviewState): ReviewState["summaryVerdict"] {
  if (findings.length === 0) {
    return "APPROVE";
  }

  const blockOn = state.repoConfig.severity.block_on;
  if (findings.some((finding) => meetsSeverityThreshold(finding, blockOn))) {
    return "REQUEST_CHANGES";
  }

  return "NEEDS_DISCUSSION";
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------

export async function reflectionAgent(state: ReviewState): Promise<ReviewState> {
  const response = await chatCompletion(loadAgentPrompt("reflection_agent"), [
    textMessage("user", buildReflectionPrompt(state)),
  ]);

  const parsed = parseReflectionResponse(response.message);
  const filteredFindings = filterFindingsForRepoConfig(parsed.verifiedFindings, state);

  return {
    ...state,
    verifiedFindings: filteredFindings,
    summaryVerdict: deriveRepoConfigVerdict(filteredFindings, state),
    needsReinvestigation: parsed.needsReinvestigation,
  };
}

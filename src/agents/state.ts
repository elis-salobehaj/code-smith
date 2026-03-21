// ---------------------------------------------------------------------------
// Shared state types flowing through the 3-agent review pipeline.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { ReviewTriggerContext } from "../api/trigger";
import type { DiffFile, MRDetails, ParsedHunk } from "../gitlab-client/types";
import type { JiraTicket } from "../integrations/jira/client";
import type { AgentMessage } from "./protocol";

// ---------------------------------------------------------------------------
// Finding — one concrete code-review finding produced by Agent 2 and
// filtered/verified by Agent 3. Defined as a Zod schema so LLM output can be
// validated at the external boundary.
// ---------------------------------------------------------------------------

export const findingSchema = z.object({
  file: z.string(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  riskLevel: z.enum(["critical", "high", "medium", "low"]),
  title: z.string(),
  description: z.string(),
  evidence: z.string(),
  suggestedFix: z.string().optional(),
  suggestedFixCode: z.string().optional(),
});

export type Finding = z.infer<typeof findingSchema>;

// ---------------------------------------------------------------------------
// ReviewState — the single mutable record passed through every pipeline stage.
// ---------------------------------------------------------------------------

export interface ReviewState {
  // --- Input ---
  mrDetails: MRDetails;
  diffFiles: DiffFile[];
  /** Structured hunks pre-parsed from diffFiles before the pipeline starts. */
  diffHunks: ParsedHunk[];
  repoPath: string;
  triggerContext: ReviewTriggerContext;
  /** Jira tickets linked from the MR title/description (Phase 4.5). Empty when Jira is disabled. */
  linkedTickets: JiraTicket[];

  // --- Agent 1 output ---
  mrIntent: string;
  changeCategories: string[];
  riskAreas: string[];

  // --- Agent 2 output ---
  rawFindings: Finding[];

  // --- Agent 3 output ---
  verifiedFindings: Finding[];
  summaryVerdict: "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION";

  // --- Internal orchestration ---
  /** Accumulated message history from Agent 2's tool-calling conversation. */
  messages: AgentMessage[];
  reinvestigationCount: number;
  needsReinvestigation: boolean;
}

// ---------------------------------------------------------------------------
// Orchestrator — custom state-machine pipeline for the 3-agent review.
//
// Pipeline:
//   contextAgent()          — maps MR intent and risk hypotheses
//     ↓
//   investigatorLoop()      — tool-calling investigation loop
//     ↓
//   reflectionAgent()       — filters noise and verdicts
//     ↓ (if needsReinvestigation, max 1 re-run)
//   investigatorLoop()      — targeted re-investigation
//     ↓
//   reflectionAgent()       — final reflection pass
//     ↓
//   return ReviewState
// ---------------------------------------------------------------------------

import { getLogger } from "../logger";
import { contextAgent } from "./context-agent";
import { investigatorLoop } from "./investigator-agent";
import { reflectionAgent } from "./reflection-agent";
import type { Finding, ReviewState } from "./state";

const logger = getLogger(["codesmith", "orchestrator"]);

// ---------------------------------------------------------------------------
// P3 — Deterministic post-processing deduplication
// ---------------------------------------------------------------------------

const RISK_ORDER: Record<Finding["riskLevel"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function mergeTwo(a: Finding, b: Finding): Finding {
  const primary = RISK_ORDER[a.riskLevel] >= RISK_ORDER[b.riskLevel] ? a : b;
  const secondary = primary === a ? b : a;
  return {
    ...primary,
    lineStart: Math.min(a.lineStart, b.lineStart),
    lineEnd: Math.max(a.lineEnd, b.lineEnd),
    description: a.description === b.description ? a.description : `${primary.description}; ${secondary.description}`,
  };
}

/**
 * Remove exact duplicates and merge findings with overlapping line ranges in
 * the same file. Applied after every Agent 3 pass so the publisher always
 * receives the minimal, highest-signal set.
 */
export function deduplicateFindings(findings: Finding[]): Finding[] {
  if (findings.length === 0) return findings;

  // Pass 1: exact duplicate removal (same file + start + end + title)
  const seen = new Set<string>();
  const noExactDups = findings.filter((f) => {
    const key = `${f.file}:${f.lineStart}:${f.lineEnd}:${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Pass 2: sort by file then lineStart, then merge overlapping ranges
  const sorted = [...noExactDups].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.lineStart - b.lineStart;
  });

  const merged: Finding[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (prev.file === curr.file && curr.lineStart <= prev.lineEnd) {
      merged[merged.length - 1] = mergeTwo(prev, curr);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/**
 * Run the full 3-agent review pipeline and return the final ReviewState.
 *
 * @param initialState - A ReviewState with mrDetails, diffFiles, and repoPath
 *                       populated. All output fields will be filled in by this
 *                       function.
 */
export async function runReview(initialState: ReviewState): Promise<ReviewState> {
  logger.info("Starting review pipeline");

  // Stage 1: Context & Intent
  logger.info("Running Agent 1: Context & Intent");
  let state = await contextAgent(initialState);

  // Stage 2: Socratic Investigation (tool loop)
  logger.info("Running Agent 2: Socratic Investigation");
  state = await investigatorLoop(state);

  // Stage 3: Reflection & Consolidation
  logger.info("Running Agent 3: Reflection & Consolidation");
  state = await reflectionAgent(state);
  state = { ...state, verifiedFindings: deduplicateFindings(state.verifiedFindings) };

  // Optional re-investigation loop (max 1 round trip)
  if (state.needsReinvestigation && state.reinvestigationCount < 1) {
    logger.info("Re-investigation requested — looping back to Agent 2");
    state = { ...state, reinvestigationCount: state.reinvestigationCount + 1 };
    state = await investigatorLoop(state);
    state = await reflectionAgent(state);
    state = { ...state, verifiedFindings: deduplicateFindings(state.verifiedFindings) };
  }

  logger.info("Review complete", { verdict: state.summaryVerdict, findings: state.verifiedFindings.length });
  return state;
}

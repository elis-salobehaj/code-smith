// ---------------------------------------------------------------------------
// GitLabPublisher — formats verified findings as GitLab inline discussions
// and a top-level summary note on the MR.
// ---------------------------------------------------------------------------

import type { Finding } from "../agents/state";
import type { ReviewTriggerMode } from "../api/trigger";
import type { GitLabClient } from "../gitlab-client/client";
import type { DiffFile, Discussion } from "../gitlab-client/types";
import { getLogger } from "../logger";
import { buildCheckpointMarker, type CheckpointSummaryContext } from "./checkpoint";
import { HEAD_MARKER_PREFIX, SUMMARY_MARKER } from "./summary-note";

const logger = getLogger(["codesmith", "publisher"]);

// ---------------------------------------------------------------------------
// Formatting helpers — exported so they can be unit-tested without a client
// ---------------------------------------------------------------------------

const RISK_EMOJI: Record<Finding["riskLevel"], string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

const VERDICT_BADGE: Record<string, string> = {
  APPROVE: "✅ APPROVE",
  REQUEST_CHANGES: "⚠️ REQUEST CHANGES",
  NEEDS_DISCUSSION: "💬 NEEDS DISCUSSION",
};

const FINDING_MARKER_PREFIX = "<!-- code-smith:finding ";

function buildFindingMarker(finding: Finding): string {
  return `${FINDING_MARKER_PREFIX}${finding.file}:${finding.lineStart}-${finding.lineEnd}:${finding.riskLevel}:${finding.title} -->`;
}

function buildPublishableLineMap(diffFiles: DiffFile[]): Map<string, Set<number>> {
  const publishableLines = new Map<string, Set<number>>();

  for (const diffFile of diffFiles) {
    if (diffFile.deletedFile) {
      continue;
    }

    let currentNewLine = 0;
    const lines = diffFile.diff.split("\n");
    const publishable = new Set<number>();

    for (const line of lines) {
      if (line.startsWith("@@")) {
        const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (match) {
          currentNewLine = Number(match[1]);
        }
        continue;
      }

      if (line.startsWith("+++") || line.startsWith("---") || line.length === 0) {
        continue;
      }

      if (line.startsWith("+")) {
        publishable.add(currentNewLine);
        currentNewLine++;
        continue;
      }

      if (line.startsWith("-")) {
        continue;
      }

      currentNewLine++;
    }

    publishableLines.set(diffFile.newPath, publishable);
  }

  return publishableLines;
}

function resolveInlineLine(finding: Finding, publishableLines: Map<string, Set<number>>): number | null {
  const candidateLines = publishableLines.get(finding.file);
  if (!candidateLines) {
    return null;
  }

  for (let lineNumber = finding.lineStart; lineNumber <= finding.lineEnd; lineNumber++) {
    if (candidateLines.has(lineNumber)) {
      return lineNumber;
    }
  }

  return null;
}

function buildSuggestionFenceHeader(finding: Finding, anchorLine: number): string {
  const linesAbove = Math.max(anchorLine - finding.lineStart, 0);
  const linesBelow = Math.max(finding.lineEnd - anchorLine, 0);
  return `\`\`\`suggestion:-${linesAbove}+${linesBelow}`;
}

export function formatFindingComment(finding: Finding, anchorLine = finding.lineStart): string {
  const emoji = RISK_EMOJI[finding.riskLevel];
  const lines = [
    buildFindingMarker(finding),
    `${emoji} **${finding.title}**`,
    "",
    finding.description,
    "",
    finding.evidence,
  ];

  if (finding.suggestedFix) {
    if (finding.suggestedFixCode !== undefined) {
      // Code suggestion: the fence is self-explanatory — skip redundant prose
      lines.push("", buildSuggestionFenceHeader(finding, anchorLine), finding.suggestedFixCode, "```");
    } else {
      // Architectural or cross-file guidance: no fence, show prose
      lines.push("", finding.suggestedFix);
    }
  }

  return lines.join("\n");
}

export function formatSummaryComment(
  verdict: string,
  findings: Finding[],
  headSha?: string,
  checkpoint?: CheckpointSummaryContext,
  summaryMessage?: string,
): string {
  const badge = VERDICT_BADGE[verdict] ?? verdict;
  const counts: Record<Finding["riskLevel"], number> = { critical: 0, high: 0, medium: 0, low: 0 };

  for (const f of findings) counts[f.riskLevel]++;

  const lines = [
    SUMMARY_MARKER,
    `## 🤖 CodeSmith Code Review — ${badge}`,
    "",
    "### Summary",
    "",
    "| Severity | Count |",
    "|---|---|",
    `| 🔴 Critical | ${counts.critical} |`,
    `| 🟠 High | ${counts.high} |`,
    `| 🟡 Medium | ${counts.medium} |`,
    `| 🔵 Low | ${counts.low} |`,
  ];

  if (findings.length === 0) {
    lines.push("", "_No findings — code looks good!_");
  } else {
    lines.push("", "### Findings", "");
    for (const f of findings) {
      const emoji = RISK_EMOJI[f.riskLevel];
      lines.push(`- ${emoji} **${f.title}** (\`${f.file}:${f.lineStart}-${f.lineEnd}\`)`);
    }
  }

  if (summaryMessage) {
    lines.push("", summaryMessage);
  }

  if (headSha) {
    lines.push("", `${HEAD_MARKER_PREFIX}${headSha} -->`);
  }
  if (checkpoint) {
    lines.push("", buildCheckpointMarker(checkpoint));
  }
  lines.push("", "---", "_Review generated by [CodeSmith](https://github.com/elis-salobehaj/code-smith)_");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GitLabPublisher
// ---------------------------------------------------------------------------

export class GitLabPublisher {
  constructor(private gitlab: GitLabClient) {}

  async postInlineComments(
    projectId: number,
    mrIid: number,
    findings: Finding[],
    diffRefs: { baseSha: string; headSha: string; startSha: string },
    diffFiles: DiffFile[],
    triggerMode: ReviewTriggerMode = "automatic",
    existingDiscussions?: Discussion[],
  ): Promise<{ posted: number; failed: number; skippedDuplicate: number; skippedUnanchored: number }> {
    if (findings.length === 0) {
      return { posted: 0, failed: 0, skippedDuplicate: 0, skippedUnanchored: 0 };
    }

    const existing = existingDiscussions ?? (await this.gitlab.getMRDiscussions(projectId, mrIid));
    const publishableLines = buildPublishableLineMap(diffFiles);
    let posted = 0;
    let failed = 0;
    let skippedDuplicate = 0;
    let skippedUnanchored = 0;

    for (const finding of findings) {
      const inlineLine = resolveInlineLine(finding, publishableLines);
      if (inlineLine === null) {
        logger.warn("Skipping non-diff finding", {
          title: finding.title,
          file: finding.file,
          lineStart: finding.lineStart,
          lineEnd: finding.lineEnd,
        });
        skippedUnanchored++;
        continue;
      }

      if (this.isDuplicate(finding, existing, diffRefs.headSha, triggerMode)) {
        logger.debug("Skipping duplicate finding", {
          title: finding.title,
          file: finding.file,
          lineStart: finding.lineStart,
        });
        skippedDuplicate++;
        continue;
      }

      try {
        await this.gitlab.createInlineDiscussion(projectId, mrIid, formatFindingComment(finding, inlineLine), {
          baseSha: diffRefs.baseSha,
          startSha: diffRefs.startSha,
          headSha: diffRefs.headSha,
          newPath: finding.file,
          newLine: inlineLine,
        });
        posted++;
      } catch (error) {
        logger.error("Failed to post finding", {
          title: finding.title,
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }
    }

    return { posted, failed, skippedDuplicate, skippedUnanchored };
  }

  /**
   * Post a top-level MR note summarising the review verdict and all findings.
   * The caller is responsible for deciding whether the review should run at all.
   * Publisher-level summary dedupe is intentionally not enforced so manual
   * reruns remain visible.
   */
  async postSummaryComment(
    projectId: number,
    mrIid: number,
    verdict: string,
    findings: Finding[],
    headSha: string,
    checkpoint?: CheckpointSummaryContext,
    summaryMessage?: string,
  ): Promise<void> {
    await this.gitlab.createMRNote(
      projectId,
      mrIid,
      formatSummaryComment(verdict, findings, headSha, checkpoint, summaryMessage),
    );
  }

  /**
   * Returns true if any existing discussion already covers the finding's
   * file + line range, indicating it was posted in a prior run.
   */
  private isDuplicate(
    finding: Finding,
    existing: Discussion[],
    currentHeadSha: string,
    triggerMode: ReviewTriggerMode,
  ): boolean {
    const marker = buildFindingMarker(finding);

    return existing.some((discussion) =>
      discussion.notes.some((note) => {
        if (!note.body.includes(marker)) {
          return false;
        }

        const position = note.position;
        if (!position || position.headSha !== currentHeadSha) {
          return false;
        }

        if (triggerMode === "automatic") {
          return true;
        }

        return (
          position.newPath === finding.file &&
          position.newLine !== null &&
          position.newLine !== undefined &&
          position.newLine >= finding.lineStart &&
          position.newLine <= finding.lineEnd
        );
      }),
    );
  }
}

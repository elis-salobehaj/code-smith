import { runReview } from "../agents/orchestrator";
import type { ReviewState } from "../agents/state";
import { config } from "../config";
import { parseDiffHunks } from "../context/diff-parser";
import { RepoManager } from "../context/repo-manager";
import { GitLabClient } from "../gitlab-client/client";
import { fetchLinkedTickets } from "../integrations/jira/client";
import { getLogger, withContext } from "../logger";
import { GitLabPublisher } from "../publisher/gitlab-publisher";
import { normalizeFindingsForPublication } from "../publisher/suggestion-normalizer";
import { findExistingSummaryNote } from "../publisher/summary-note";
import type { WebhookPayload } from "./schemas";
import type { ReviewTriggerContext } from "./trigger";

const logger = getLogger(["gandalf", "pipeline"]);

const gitlabClient = new GitLabClient();
const repoManager = new RepoManager();
const publisher = new GitLabPublisher(gitlabClient);

export function findAutomaticReviewSkipSummary(
  trigger: ReviewTriggerContext,
  existingNotes: Array<{ id: number; body: string }>,
  headSha: string,
): { id: number; body: string } | null {
  if (trigger.mode !== "automatic") {
    return null;
  }

  return findExistingSummaryNote(existingNotes, headSha);
}

/**
 * Full pipeline: parse webhook → fetch MR data → clone repo → run agents →
 * publish findings as inline discussions + summary note.
 * Called fire-and-forget by the router; errors are logged at the call site.
 */
export async function runPipeline(event: WebhookPayload, trigger: ReviewTriggerContext): Promise<void> {
  const projectId = event.project.id;
  const mrIid = event.object_kind === "merge_request" ? event.object_attributes.iid : event.merge_request.iid;

  await withContext({ projectId, mrIid }, async () => {
    logger.info("Starting review for MR", {
      projectId,
      mrIid,
      triggerMode: trigger.mode,
      triggerSource: trigger.source,
    });

    // 1. Fetch MR metadata first so automatic runs can skip unchanged heads
    const mrDetails = await gitlabClient.getMRDetails(projectId, mrIid);

    if (trigger.mode === "automatic") {
      const existingNotes = await gitlabClient.getMRNotes(projectId, mrIid);
      const existingSummary = findAutomaticReviewSkipSummary(trigger, existingNotes, mrDetails.headSha);

      if (existingSummary) {
        logger.info("Skipping automatic review — same head SHA already reviewed", {
          headSha: mrDetails.headSha,
          existingNoteId: existingSummary.id,
        });
        return;
      }
    }

    const diffFiles = await gitlabClient.getMRDiff(projectId, mrIid);

    // 2. Clone or update the source branch into the local cache
    const repoPath = await repoManager.cloneOrUpdate(event.project.web_url, mrDetails.sourceBranch, projectId);

    // 3. Fetch linked Jira tickets (read-only; degrades safely when disabled or unavailable)
    const linkedTickets = await fetchLinkedTickets(mrDetails.title, mrDetails.description ?? undefined, config);

    // 4. Build initial ReviewState and run the 3-agent pipeline
    const initialState: ReviewState = {
      mrDetails,
      diffFiles,
      diffHunks: parseDiffHunks(diffFiles),
      repoPath,
      triggerContext: trigger,
      linkedTickets,
      mrIntent: "",
      changeCategories: [],
      riskAreas: [],
      rawFindings: [],
      verifiedFindings: [],
      summaryVerdict: "APPROVE",
      messages: [],
      reinvestigationCount: 0,
      needsReinvestigation: false,
    };

    const finalState = await runReview(initialState);

    for (const f of finalState.verifiedFindings) {
      logger.debug("Verified finding pre-normalization", {
        file: f.file,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
        riskLevel: f.riskLevel,
        hasSuggestedFixCode: f.suggestedFixCode !== undefined,
        suggestedFixCode: f.suggestedFixCode,
      });
    }

    const publishableFindings = await normalizeFindingsForPublication(repoPath, finalState.verifiedFindings);

    for (const f of publishableFindings) {
      logger.debug("Publishable finding post-normalization", {
        file: f.file,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
        hasSuggestedFixCode: f.suggestedFixCode !== undefined,
        suggestedFixCode: f.suggestedFixCode,
      });
    }

    // 5. Publish inline comments for each verified finding, then a summary note
    const diffRefs = {
      baseSha: mrDetails.baseSha,
      headSha: mrDetails.headSha,
      startSha: mrDetails.startSha,
    };

    await publisher.postInlineComments(projectId, mrIid, publishableFindings, diffRefs, diffFiles);
    await publisher.postSummaryComment(
      projectId,
      mrIid,
      finalState.summaryVerdict,
      publishableFindings,
      mrDetails.headSha,
    );

    logger.info("Review complete", {
      mrIid,
      verdict: finalState.summaryVerdict,
      findings: publishableFindings.length,
    });
  });
}

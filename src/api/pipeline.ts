import { runReview } from "../agents/orchestrator";
import { selectReviewRange } from "../agents/review-range";
import type { ReviewState } from "../agents/state";
import { config } from "../config";
import { type RepoConfig, shouldSkipFileForRepoReview } from "../config/repo-config";
import { loadRepoConfig } from "../config/repo-config-loader";
import { parseDiffHunks } from "../context/diff-parser";
import { RepoManager } from "../context/repo-manager";
import { GitLabClient } from "../gitlab-client/client";
import type { DiffFile } from "../gitlab-client/types";
import { fetchLinkedTickets } from "../integrations/jira/client";
import { getLogger, withContext } from "../logger";
import { findLatestSuccessfulCheckpoint } from "../publisher/checkpoint";
import { GitLabPublisher } from "../publisher/gitlab-publisher";
import { normalizeFindingsForPublication } from "../publisher/suggestion-normalizer";
import { findExistingSummaryNote } from "../publisher/summary-note";
import type { WebhookPayload } from "./schemas";
import type { ReviewTriggerContext } from "./trigger";

const logger = getLogger(["codesmith", "pipeline"]);

const branchPipelineLocks = new Map<string, Promise<void>>();

export interface PipelineDependencies {
  gitlabClient: GitLabClient;
  repoManager: RepoManager;
  publisher: GitLabPublisher;
  runReview: typeof runReview;
  fetchLinkedTickets: typeof fetchLinkedTickets;
  normalizeFindingsForPublication: typeof normalizeFindingsForPublication;
}

function createPipelineDependencies(): PipelineDependencies {
  const gitlabClient = new GitLabClient();
  return {
    gitlabClient,
    repoManager: new RepoManager(),
    publisher: new GitLabPublisher(gitlabClient),
    runReview,
    fetchLinkedTickets,
    normalizeFindingsForPublication,
  };
}

let pipelineDependencies = createPipelineDependencies();

function getDiffFileRepoPath(diffFile: DiffFile): string {
  return diffFile.deletedFile ? diffFile.oldPath : diffFile.newPath;
}

export function filterDiffFilesForRepoReview(diffFiles: DiffFile[], repoConfig: RepoConfig): DiffFile[] {
  return diffFiles.filter((diffFile) => !shouldSkipFileForRepoReview(repoConfig, getDiffFileRepoPath(diffFile)));
}

function getSourceBranch(event: WebhookPayload): string {
  return event.object_kind === "merge_request"
    ? event.object_attributes.source_branch
    : event.merge_request.source_branch;
}

async function withBranchPipelineLock<T>(projectId: number, branch: string, task: () => Promise<T>): Promise<T> {
  const lockKey = `${projectId}-${branch}`;
  const previous = branchPipelineLocks.get(lockKey) ?? Promise.resolve();
  let releaseCurrent: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const currentChain = previous.catch(() => undefined).then(() => current);

  if (branchPipelineLocks.has(lockKey)) {
    logger.debug("Waiting for branch pipeline lock", { lockKey, requestedBranch: branch });
  }

  branchPipelineLocks.set(lockKey, currentChain);
  await previous.catch(() => undefined);

  logger.debug("Acquired branch pipeline lock", { lockKey, requestedBranch: branch });

  try {
    return await task();
  } finally {
    releaseCurrent?.();
    if (branchPipelineLocks.get(lockKey) === currentChain) {
      branchPipelineLocks.delete(lockKey);
    }
    logger.debug("Released branch pipeline lock", { lockKey, requestedBranch: branch });
  }
}

export function resetPipelineBranchLocksForTests(): void {
  branchPipelineLocks.clear();
}

export function setPipelineDependenciesForTests(dependencies: PipelineDependencies): void {
  pipelineDependencies = dependencies;
}

export function resetPipelineDependenciesForTests(): void {
  pipelineDependencies = createPipelineDependencies();
}

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
  const sourceBranch = getSourceBranch(event);
  const {
    gitlabClient,
    repoManager,
    publisher,
    runReview: executeReview,
    fetchLinkedTickets: loadLinkedTickets,
    normalizeFindingsForPublication: normalizeFindings,
  } = pipelineDependencies;
  let mrDetails: Awaited<ReturnType<GitLabClient["getMRDetails"]>> | null = null;
  let latestMrVersionId = 1;

  await withBranchPipelineLock(projectId, sourceBranch, async () => {
    await withContext({ projectId, mrIid }, async () => {
      try {
        logger.info("Starting review for MR", {
          projectId,
          mrIid,
          triggerMode: trigger.mode,
          triggerSource: trigger.source,
          requestedBranch: sourceBranch,
        });

        // 1. Fetch MR metadata first so automatic runs can skip unchanged heads
        mrDetails = await gitlabClient.getMRDetails(projectId, mrIid);

        const [mrDiffFiles, discussions, summaryNotes, mrVersions, mrCommits] = await Promise.all([
          gitlabClient.getMRDiff(projectId, mrIid),
          gitlabClient.getMRDiscussions(projectId, mrIid),
          gitlabClient.getMRNotes(projectId, mrIid),
          gitlabClient.getMRVersions(projectId, mrIid),
          gitlabClient.getMRCommits(projectId, mrIid),
        ]);
        latestMrVersionId = mrVersions.at(-1)?.id ?? 1;

        if (trigger.mode === "automatic") {
          const existingSummary = findAutomaticReviewSkipSummary(trigger, summaryNotes, mrDetails.headSha);

          if (existingSummary) {
            logger.info("Skipping automatic review — same head SHA already reviewed", {
              headSha: mrDetails.headSha,
              existingNoteId: existingSummary.id,
              requestedBranch: mrDetails.sourceBranch,
            });
            return;
          }
        }

        const checkpoint = findLatestSuccessfulCheckpoint(summaryNotes);
        const fullRangeStartSha = mrDetails.startSha || mrDetails.baseSha || mrDetails.headSha;
        const automaticReviewRange = selectReviewRange(checkpoint, mrCommits, mrDetails.headSha, fullRangeStartSha);
        const reviewRange =
          trigger.mode === "manual"
            ? {
                rangeStart: fullRangeStartSha,
                rangeEnd: mrDetails.headSha,
                mode: "full" as const,
              }
            : automaticReviewRange;

        logger.debug("Computed review range", {
          requestedBranch: mrDetails.sourceBranch,
          expectedHeadSha: mrDetails.headSha,
          reviewRangeMode: reviewRange.mode,
          reviewRangeStart: reviewRange.rangeStart,
          reviewRangeEnd: reviewRange.rangeEnd,
        });

        if (trigger.mode === "automatic" && reviewRange.mode === "skip") {
          logger.info("Skipping automatic review — no new code delta exists", {
            headSha: mrDetails.headSha,
            checkpointRangeEndSha: checkpoint?.rangeEndSha,
          });
          return;
        }

        const analysisDiffFiles =
          reviewRange.mode === "incremental"
            ? await gitlabClient.getRepositoryCompareDiff(projectId, reviewRange.rangeStart, reviewRange.rangeEnd)
            : mrDiffFiles;

        if (trigger.mode === "automatic" && analysisDiffFiles.length === 0) {
          logger.info("Skipping automatic review — computed review range has no diff entries", {
            rangeStart: reviewRange.rangeStart,
            rangeEnd: reviewRange.rangeEnd,
          });
          return;
        }

        // 2. Clone or update the source branch into the local cache
        const repoPath = await repoManager.cloneOrUpdate(
          event.project.web_url,
          mrDetails.sourceBranch,
          projectId,
          mrDetails.headSha,
        );
        const repoConfig = await loadRepoConfig(repoPath);
        logger.debug("Repo cache prepared", {
          requestedBranch: mrDetails.sourceBranch,
          expectedHeadSha: mrDetails.headSha,
          cachePath: repoPath,
        });

        const filteredAnalysisDiffFiles = filterDiffFilesForRepoReview(analysisDiffFiles, repoConfig);

        logger.debug("Applied repo review config to analysis diff", {
          requestedBranch: mrDetails.sourceBranch,
          configExcludePatterns: repoConfig.exclude.length,
          configFileRules: repoConfig.file_rules.length,
          originalDiffFiles: analysisDiffFiles.length,
          filteredDiffFiles: filteredAnalysisDiffFiles.length,
        });

        if (trigger.mode === "automatic" && filteredAnalysisDiffFiles.length === 0) {
          logger.info("Skipping automatic review — repo review config excluded all diff files", {
            rangeStart: reviewRange.rangeStart,
            rangeEnd: reviewRange.rangeEnd,
          });
          return;
        }

        // 3. Fetch linked Jira tickets (read-only; degrades safely when disabled or unavailable)
        const linkedTickets = await loadLinkedTickets(mrDetails.title, mrDetails.description ?? undefined, config);

        // 4. Build initial ReviewState and run the 3-agent pipeline
        const initialState: ReviewState = {
          mrDetails,
          diffFiles: filteredAnalysisDiffFiles,
          diffHunks: parseDiffHunks(filteredAnalysisDiffFiles),
          repoPath,
          repoConfig,
          triggerContext: trigger,
          linkedTickets,
          discussions,
          summaryNotes,
          checkpoint,
          reviewRange,
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

        const finalState = await executeReview(initialState);

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

        const publishableFindings = await normalizeFindings(repoPath, finalState.verifiedFindings);

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

        const inlinePublishResult = await publisher.postInlineComments(
          projectId,
          mrIid,
          publishableFindings,
          diffRefs,
          mrDiffFiles,
          trigger.mode,
          finalState.discussions,
        );
        const checkpointStatus = inlinePublishResult.failed > 0 ? "partial" : "success";
        const summaryMessage =
          checkpointStatus === "partial"
            ? "_Review completed, but one or more inline comments could not be published. The run was recorded as partial._"
            : undefined;

        await publisher.postSummaryComment(
          projectId,
          mrIid,
          finalState.summaryVerdict,
          publishableFindings,
          mrDetails.headSha,
          {
            status: checkpointStatus,
            trigger: trigger.mode,
            rangeStartSha: reviewRange.rangeStart,
            rangeEndSha: reviewRange.rangeEnd,
            mrVersionId: latestMrVersionId,
            publishedInline: inlinePublishResult.posted > 0,
            publishedSummary: true,
            runId: Bun.randomUUIDv7(),
            timestamp: new Date().toISOString(),
            source: trigger.source,
          },
          summaryMessage,
        );

        logger.info("Review complete", {
          mrIid,
          verdict: finalState.summaryVerdict,
          findings: publishableFindings.length,
          checkpointStatus,
        });
      } catch (error) {
        logger.error("Review failed", {
          error: error instanceof Error ? error.message : String(error),
        });

        if (mrDetails) {
          await publisher.postSummaryComment(
            projectId,
            mrIid,
            "NEEDS_DISCUSSION",
            [],
            mrDetails.headSha,
            {
              status: "failed",
              trigger: trigger.mode,
              rangeStartSha: mrDetails.startSha || mrDetails.baseSha || mrDetails.headSha,
              rangeEndSha: mrDetails.headSha,
              mrVersionId: latestMrVersionId,
              publishedInline: false,
              publishedSummary: true,
              runId: Bun.randomUUIDv7(),
              timestamp: new Date().toISOString(),
              source: trigger.source,
            },
            "_Review run failed before completion. This checkpoint is recorded as failed and is ignored for future automatic range selection._",
          );
        }

        throw error;
      }
    });
  });
}

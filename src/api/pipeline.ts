import { reviewCandidateRepoConfigSecurity } from "../agents/config-security-agent";
import { runReview } from "../agents/orchestrator";
import { selectReviewRange } from "../agents/review-range";
import type { CandidateRepoConfigChangeType, ReviewState } from "../agents/state";
import { config } from "../config";
import { DEFAULT_REPO_CONFIG, type RepoConfig, shouldSkipFileForRepoReview } from "../config/repo-config";
import {
  parseRepoConfigText,
  type RepoConfigLoadResult,
  readRepoConfigFromRepoPath,
} from "../config/repo-config-loader";
import {
  createRepoConfigOversizeIssue,
  evaluateRepoConfigSecurity,
  formatRepoConfigSecurityIssue,
  mergeRepoConfigSecurityIssues,
  type RepoConfigSecurityIssue,
  sanitizeRepoConfig,
} from "../config/repo-config-security";
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
  reviewCandidateRepoConfigSecurity: typeof reviewCandidateRepoConfigSecurity;
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
    reviewCandidateRepoConfigSecurity,
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

function cloneDefaultRepoConfig(): RepoConfig {
  return structuredClone(DEFAULT_REPO_CONFIG);
}

function resolveCandidateRepoConfigChangeType(
  candidate: RepoConfigLoadResult,
  trustedPresent: boolean,
  trustedHash: string | null,
): CandidateRepoConfigChangeType {
  if (!candidate.present) {
    return trustedPresent ? "removed" : "unchanged";
  }

  if (!trustedPresent) {
    return "added";
  }

  return candidate.hash === trustedHash ? "unchanged" : "modified";
}

async function resolveTrustedBaselineRepoConfig(
  gitlabClient: GitLabClient,
  projectId: number,
  targetBranch: string,
): Promise<{ repoConfig: RepoConfig; present: boolean; hash: string | null }> {
  const configFile = await gitlabClient.getRepoConfigFileAtRef(projectId, targetBranch);

  if (!configFile) {
    logger.info("No trusted repo review config found on target branch; using defaults", {
      projectId,
      targetBranch,
    });
    return {
      repoConfig: cloneDefaultRepoConfig(),
      present: false,
      hash: null,
    };
  }

  const parsed = parseRepoConfigText(configFile.fileName, configFile.rawText);

  if (parsed.status === "loaded" && parsed.parsedConfig) {
    logger.debug("Loaded trusted repo review config from target branch", {
      projectId,
      targetBranch,
      configPath: configFile.fileName,
    });
    return {
      repoConfig: parsed.parsedConfig,
      present: true,
      hash: parsed.hash,
    };
  }

  if (parsed.status === "byte_cap_exceeded") {
    logger.warn("Trusted repo review config exceeded byte cap; using defaults", {
      projectId,
      targetBranch,
      configPath: configFile.fileName,
      byteCount: parsed.byteCount,
      maxBytes: config.SECURITY_GATE_MAX_CONFIG_BYTES,
    });
  } else if (parsed.status === "invalid") {
    logger.warn("Trusted repo review config failed validation; using defaults", {
      projectId,
      targetBranch,
      configPath: configFile.fileName,
      issues: parsed.validationIssues,
    });
  } else {
    logger.warn("Trusted repo review config could not be parsed; using defaults", {
      projectId,
      targetBranch,
      configPath: configFile.fileName,
      error: parsed.validationIssues[0] ?? "unknown parse error",
    });
  }

  return {
    repoConfig: cloneDefaultRepoConfig(),
    present: true,
    hash: parsed.hash,
  };
}

function resolveCandidateRepoConfigIssues(candidate: RepoConfigLoadResult): RepoConfigSecurityIssue[] {
  if (candidate.status === "byte_cap_exceeded") {
    return [createRepoConfigOversizeIssue(candidate.byteCount ?? 0, config.SECURITY_GATE_MAX_CONFIG_BYTES)];
  }

  if (candidate.status !== "loaded") {
    return [];
  }

  if (!candidate.parsedConfig) {
    return [];
  }

  return evaluateRepoConfigSecurity(candidate.parsedConfig).issues;
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
    reviewCandidateRepoConfigSecurity: executeConfigSecurityReview,
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
        const [trustedRepoConfigResult, candidateRepoConfig] = await Promise.all([
          resolveTrustedBaselineRepoConfig(gitlabClient, projectId, mrDetails.targetBranch),
          readRepoConfigFromRepoPath(repoPath),
        ]);
        const repoConfig = trustedRepoConfigResult.repoConfig;
        const deterministicCandidateRepoConfigIssues =
          config.ENABLE_SECURITY_GATE_AGENT && candidateRepoConfig.present
            ? resolveCandidateRepoConfigIssues(candidateRepoConfig)
            : [];
        let candidateRepoConfigIssues = deterministicCandidateRepoConfigIssues;
        let candidateRepoConfigSecuritySummary = "";
        let candidateRepoConfigLlmReviewed = false;
        let candidateRepoConfigLlmReviewFailed = false;

        if (
          config.ENABLE_SECURITY_GATE_AGENT &&
          !config.SECURITY_GATE_DETERMINISTIC_ONLY &&
          candidateRepoConfig.status === "loaded" &&
          candidateRepoConfig.parsedConfig
        ) {
          try {
            const llmReview = await executeConfigSecurityReview(
              candidateRepoConfig.parsedConfig,
              deterministicCandidateRepoConfigIssues,
            );
            candidateRepoConfigIssues = mergeRepoConfigSecurityIssues(
              deterministicCandidateRepoConfigIssues,
              llmReview.issues,
            );
            candidateRepoConfigSecuritySummary = llmReview.summary;
            candidateRepoConfigLlmReviewed = true;
          } catch (error) {
            candidateRepoConfigLlmReviewFailed = true;
            logger.warn(
              "Candidate repo review config security LLM review failed; continuing with deterministic findings",
              {
                requestedBranch: mrDetails.sourceBranch,
                targetBranch: mrDetails.targetBranch,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }

        if (candidateRepoConfig.status !== "not_found") {
          logger.debug("Loaded candidate repo review config metadata", {
            requestedBranch: mrDetails.sourceBranch,
            targetBranch: mrDetails.targetBranch,
            status: candidateRepoConfig.status,
            byteCount: candidateRepoConfig.byteCount,
            gateEnabled: config.ENABLE_SECURITY_GATE_AGENT,
            deterministicOnly: config.SECURITY_GATE_DETERMINISTIC_ONLY,
            llmReviewed: candidateRepoConfigLlmReviewed,
          });
        }

        if (candidateRepoConfigIssues.length > 0) {
          logger.warn("Candidate repo review config contained security findings", {
            requestedBranch: mrDetails.sourceBranch,
            targetBranch: mrDetails.targetBranch,
            issueCount: candidateRepoConfigIssues.length,
            issues: candidateRepoConfigIssues.map(formatRepoConfigSecurityIssue),
          });
        }

        if (
          config.ENABLE_SECURITY_GATE_AGENT &&
          candidateRepoConfig.status === "loaded" &&
          candidateRepoConfig.parsedConfig
        ) {
          const candidateEffectiveRepoConfig = sanitizeRepoConfig(
            candidateRepoConfig.parsedConfig,
            candidateRepoConfigIssues,
          );
          logger.debug("Derived candidate effective repo config for audit", {
            requestedBranch: mrDetails.sourceBranch,
            targetBranch: mrDetails.targetBranch,
            candidateExcludePatterns: candidateEffectiveRepoConfig.exclude.length,
            candidateFileRules: candidateEffectiveRepoConfig.file_rules.length,
            hasReviewInstructions: candidateEffectiveRepoConfig.review_instructions !== undefined,
          });
        }

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
          candidateRepoConfigPresent: candidateRepoConfig.present,
          candidateRepoConfigBytes: candidateRepoConfig.byteCount,
          candidateRepoConfigHash: candidateRepoConfig.hash,
          candidateRepoConfigStatus: candidateRepoConfig.status,
          candidateRepoConfigIssues: candidateRepoConfigIssues,
          candidateRepoConfigSecuritySummary: candidateRepoConfigSecuritySummary,
          candidateRepoConfigChangeType: resolveCandidateRepoConfigChangeType(
            candidateRepoConfig,
            trustedRepoConfigResult.present,
            trustedRepoConfigResult.hash,
          ),
          candidateRepoConfigGateEnabled: config.ENABLE_SECURITY_GATE_AGENT,
          candidateRepoConfigDeterministicOnly: config.SECURITY_GATE_DETERMINISTIC_ONLY,
          candidateRepoConfigLlmReviewed: candidateRepoConfigLlmReviewed,
          candidateRepoConfigLlmReviewFailed: candidateRepoConfigLlmReviewFailed,
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

        if (candidateRepoConfigIssues.length > 0) {
          await publisher.postConfigSecurityNote(projectId, mrIid, mrDetails.headSha, candidateRepoConfigIssues, {
            existingNotes: summaryNotes,
            candidateChangeType: initialState.candidateRepoConfigChangeType,
            candidateRepoConfigBytes: initialState.candidateRepoConfigBytes,
            deterministicOnly: config.SECURITY_GATE_DETERMINISTIC_ONLY,
            securitySummary: initialState.candidateRepoConfigSecuritySummary,
          });
        }

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

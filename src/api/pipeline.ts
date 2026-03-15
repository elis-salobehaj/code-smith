import { runReview } from "../agents/orchestrator";
import type { ReviewState } from "../agents/state";
import { RepoManager } from "../context/repo-manager";
import { GitLabClient } from "../gitlab-client/client";
import { GitLabPublisher } from "../publisher/gitlab-publisher";
import type { WebhookPayload } from "./schemas";

const gitlabClient = new GitLabClient();
const repoManager = new RepoManager();
const publisher = new GitLabPublisher(gitlabClient);

/**
 * Full pipeline: parse webhook → fetch MR data → clone repo → run agents →
 * publish findings as inline discussions + summary note.
 * Called fire-and-forget by the router; errors are logged at the call site.
 */
export async function runPipeline(event: WebhookPayload): Promise<void> {
  const projectId = event.project.id;
  const mrIid = event.object_kind === "merge_request" ? event.object_attributes.iid : event.merge_request.iid;

  console.log(`[pipeline] Starting review for project=${projectId} MR!${mrIid}`);

  // 1. Fetch MR metadata and diff in parallel
  const [mrDetails, diffFiles] = await Promise.all([
    gitlabClient.getMRDetails(projectId, mrIid),
    gitlabClient.getMRDiff(projectId, mrIid),
  ]);

  // 2. Clone or update the source branch into the local cache
  const repoPath = await repoManager.cloneOrUpdate(event.project.web_url, mrDetails.sourceBranch, projectId);

  // 3. Build initial ReviewState and run the 3-agent pipeline
  const initialState: ReviewState = {
    mrDetails,
    diffFiles,
    repoPath,
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

  // 4. Publish inline comments for each verified finding, then a summary note
  const diffRefs = {
    baseSha: mrDetails.baseSha,
    headSha: mrDetails.headSha,
    startSha: mrDetails.startSha,
  };

  await publisher.postInlineComments(projectId, mrIid, finalState.verifiedFindings, diffRefs, diffFiles);
  await publisher.postSummaryComment(projectId, mrIid, finalState.summaryVerdict, finalState.verifiedFindings);

  console.log(
    `[pipeline] Review complete for MR!${mrIid}: ${finalState.summaryVerdict} (${finalState.verifiedFindings.length} findings)`,
  );
}

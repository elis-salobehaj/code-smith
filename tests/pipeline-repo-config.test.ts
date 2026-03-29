import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewState } from "../src/agents/state";
import type { PipelineDependencies } from "../src/api/pipeline";
import {
  resetPipelineBranchLocksForTests,
  resetPipelineDependenciesForTests,
  runPipeline,
  setPipelineDependenciesForTests,
} from "../src/api/pipeline";
import type { DiffFile, MRCommit, MRDetails, MRVersion } from "../src/gitlab-client/types";

const tempRepos: string[] = [];
const observedStates: ReviewState[] = [];

const cloneOrUpdateMock = mock(async () => "");
const fetchLinkedTicketsMock = mock(async () => []);
const normalizeFindingsMock = mock(async () => []);
const postInlineCommentsMock = mock(async () => ({ posted: 0, failed: 0, skippedDuplicate: 0, skippedUnanchored: 0 }));
const postSummaryCommentMock = mock(async () => undefined);
const runReviewMock = mock(async (state: ReviewState) => {
  observedStates.push(state);
  return state;
});

const mrDetails: MRDetails = {
  id: 1,
  iid: 7,
  projectId: 42,
  title: "Feature branch review",
  description: "desc",
  sourceBranch: "feature/branch",
  targetBranch: "main",
  state: "opened",
  webUrl: "https://gitlab.example.com/acme/repo/-/merge_requests/7",
  authorUsername: "alice",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  startSha: "c".repeat(40),
};

const mrVersions: MRVersion[] = [
  {
    id: 1,
    headCommitSha: mrDetails.headSha,
    baseCommitSha: mrDetails.baseSha,
    startCommitSha: mrDetails.startSha,
    createdAt: "2026-03-21T00:00:00.000Z",
  },
];

const mrCommits: MRCommit[] = [
  {
    id: mrDetails.headSha,
    shortId: mrDetails.headSha.slice(0, 8),
    title: "feat: add example",
    authoredDate: "2026-03-21T00:00:00.000Z",
    committedDate: "2026-03-21T00:00:00.000Z",
    parentIds: [mrDetails.baseSha],
  },
];

const getMRDetailsMock = mock(async () => mrDetails);
const getMRDiffMock = mock(async (): Promise<DiffFile[]> => []);
const getMRDiscussionsMock = mock(async () => []);
const getMRNotesMock = mock(async () => []);
const getMRVersionsMock = mock(async () => mrVersions);
const getMRCommitsMock = mock(async () => mrCommits);
const getRepositoryCompareDiffMock = mock(async (): Promise<DiffFile[]> => []);

const manualTrigger = {
  mode: "manual",
  source: "mr_note_command",
  noteId: 1,
  rawCommand: "/ai-review",
} as const;

const event = {
  object_kind: "merge_request",
  event_type: "merge_request",
  project: {
    id: 42,
    web_url: "https://gitlab.example.com/acme/repo",
    path_with_namespace: "acme/repo",
  },
  user: {
    id: 1,
    name: "Alice",
    username: "alice",
  },
  object_attributes: {
    iid: 7,
    title: mrDetails.title,
    description: mrDetails.description,
    source_branch: mrDetails.sourceBranch,
    target_branch: mrDetails.targetBranch,
    action: "update",
    url: mrDetails.webUrl,
    state: mrDetails.state,
  },
} as const;

async function createTempRepo(): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "code-smith-pipeline-config-"));
  tempRepos.push(repoPath);
  return repoPath;
}

beforeEach(() => {
  observedStates.length = 0;
  resetPipelineBranchLocksForTests();
  resetPipelineDependenciesForTests();

  cloneOrUpdateMock.mockReset();
  fetchLinkedTicketsMock.mockReset();
  normalizeFindingsMock.mockReset();
  postInlineCommentsMock.mockReset();
  postSummaryCommentMock.mockReset();
  runReviewMock.mockReset();
  getMRDetailsMock.mockReset();
  getMRDiffMock.mockReset();
  getMRDiscussionsMock.mockReset();
  getMRNotesMock.mockReset();
  getMRVersionsMock.mockReset();
  getMRCommitsMock.mockReset();
  getRepositoryCompareDiffMock.mockReset();

  fetchLinkedTicketsMock.mockResolvedValue([]);
  normalizeFindingsMock.mockResolvedValue([]);
  postInlineCommentsMock.mockResolvedValue({ posted: 0, failed: 0, skippedDuplicate: 0, skippedUnanchored: 0 });
  postSummaryCommentMock.mockResolvedValue(undefined);
  runReviewMock.mockImplementation(async (state: ReviewState) => {
    observedStates.push(state);
    return state;
  });
  getMRDetailsMock.mockResolvedValue(mrDetails);
  getMRDiscussionsMock.mockResolvedValue([]);
  getMRNotesMock.mockResolvedValue([]);
  getMRVersionsMock.mockResolvedValue(mrVersions);
  getMRCommitsMock.mockResolvedValue(mrCommits);
  getRepositoryCompareDiffMock.mockResolvedValue([]);
});

afterEach(async () => {
  resetPipelineBranchLocksForTests();
  resetPipelineDependenciesForTests();
  await Promise.all(tempRepos.splice(0).map((repoPath) => rm(repoPath, { recursive: true, force: true })));
});

describe("runPipeline repo config integration", () => {
  it("loads repo config and attaches it to ReviewState", async () => {
    const repoPath = await createTempRepo();
    await Bun.write(
      join(repoPath, ".codesmith.yaml"),
      ["version: 1", "review_instructions: Focus on auth paths.", "severity:", "  minimum: medium"].join("\n"),
    );

    cloneOrUpdateMock.mockResolvedValue(repoPath);
    getMRDiffMock.mockResolvedValue([
      {
        oldPath: "src/example.ts",
        newPath: "src/example.ts",
        newFile: false,
        deletedFile: false,
        renamedFile: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    ]);

    setPipelineDependenciesForTests({
      gitlabClient: {
        getMRDetails: getMRDetailsMock,
        getMRDiff: getMRDiffMock,
        getMRDiscussions: getMRDiscussionsMock,
        getMRNotes: getMRNotesMock,
        getMRVersions: getMRVersionsMock,
        getMRCommits: getMRCommitsMock,
        getRepositoryCompareDiff: getRepositoryCompareDiffMock,
      } as unknown as PipelineDependencies["gitlabClient"],
      repoManager: {
        cloneOrUpdate: cloneOrUpdateMock,
      } as unknown as PipelineDependencies["repoManager"],
      publisher: {
        postInlineComments: postInlineCommentsMock,
        postSummaryComment: postSummaryCommentMock,
      } as unknown as PipelineDependencies["publisher"],
      runReview: runReviewMock as unknown as PipelineDependencies["runReview"],
      fetchLinkedTickets: fetchLinkedTicketsMock as unknown as PipelineDependencies["fetchLinkedTickets"],
      normalizeFindingsForPublication:
        normalizeFindingsMock as unknown as PipelineDependencies["normalizeFindingsForPublication"],
    });

    await runPipeline(event, manualTrigger);

    expect(observedStates).toHaveLength(1);
    expect(observedStates[0]?.repoConfig.review_instructions).toBe("Focus on auth paths.");
    expect(observedStates[0]?.repoConfig.severity.minimum).toBe("medium");
  });

  it("filters excluded files before the agent pipeline runs", async () => {
    const repoPath = await createTempRepo();
    await Bun.write(join(repoPath, ".codesmith.yaml"), ["version: 1", "exclude:", "  - dist/**"].join("\n"));

    cloneOrUpdateMock.mockResolvedValue(repoPath);
    getMRDiffMock.mockResolvedValue([
      {
        oldPath: "src/example.ts",
        newPath: "src/example.ts",
        newFile: false,
        deletedFile: false,
        renamedFile: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
      {
        oldPath: "dist/generated.js",
        newPath: "dist/generated.js",
        newFile: false,
        deletedFile: false,
        renamedFile: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    ]);

    setPipelineDependenciesForTests({
      gitlabClient: {
        getMRDetails: getMRDetailsMock,
        getMRDiff: getMRDiffMock,
        getMRDiscussions: getMRDiscussionsMock,
        getMRNotes: getMRNotesMock,
        getMRVersions: getMRVersionsMock,
        getMRCommits: getMRCommitsMock,
        getRepositoryCompareDiff: getRepositoryCompareDiffMock,
      } as unknown as PipelineDependencies["gitlabClient"],
      repoManager: {
        cloneOrUpdate: cloneOrUpdateMock,
      } as unknown as PipelineDependencies["repoManager"],
      publisher: {
        postInlineComments: postInlineCommentsMock,
        postSummaryComment: postSummaryCommentMock,
      } as unknown as PipelineDependencies["publisher"],
      runReview: runReviewMock as unknown as PipelineDependencies["runReview"],
      fetchLinkedTickets: fetchLinkedTicketsMock as unknown as PipelineDependencies["fetchLinkedTickets"],
      normalizeFindingsForPublication:
        normalizeFindingsMock as unknown as PipelineDependencies["normalizeFindingsForPublication"],
    });

    await runPipeline(event, manualTrigger);

    expect(observedStates).toHaveLength(1);
    expect(observedStates[0]?.diffFiles.map((file) => file.newPath)).toEqual(["src/example.ts"]);
  });

  it("filters files marked with skip rules before the agent pipeline runs", async () => {
    const repoPath = await createTempRepo();
    await Bun.write(
      join(repoPath, ".codesmith.yaml"),
      ["version: 1", "file_rules:", '  - pattern: "**/*.generated.ts"', "    skip: true"].join("\n"),
    );

    cloneOrUpdateMock.mockResolvedValue(repoPath);
    getMRDiffMock.mockResolvedValue([
      {
        oldPath: "src/types.generated.ts",
        newPath: "src/types.generated.ts",
        newFile: false,
        deletedFile: false,
        renamedFile: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
      {
        oldPath: "src/example.ts",
        newPath: "src/example.ts",
        newFile: false,
        deletedFile: false,
        renamedFile: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    ]);

    setPipelineDependenciesForTests({
      gitlabClient: {
        getMRDetails: getMRDetailsMock,
        getMRDiff: getMRDiffMock,
        getMRDiscussions: getMRDiscussionsMock,
        getMRNotes: getMRNotesMock,
        getMRVersions: getMRVersionsMock,
        getMRCommits: getMRCommitsMock,
        getRepositoryCompareDiff: getRepositoryCompareDiffMock,
      } as unknown as PipelineDependencies["gitlabClient"],
      repoManager: {
        cloneOrUpdate: cloneOrUpdateMock,
      } as unknown as PipelineDependencies["repoManager"],
      publisher: {
        postInlineComments: postInlineCommentsMock,
        postSummaryComment: postSummaryCommentMock,
      } as unknown as PipelineDependencies["publisher"],
      runReview: runReviewMock as unknown as PipelineDependencies["runReview"],
      fetchLinkedTickets: fetchLinkedTicketsMock as unknown as PipelineDependencies["fetchLinkedTickets"],
      normalizeFindingsForPublication:
        normalizeFindingsMock as unknown as PipelineDependencies["normalizeFindingsForPublication"],
    });

    await runPipeline(event, manualTrigger);

    expect(observedStates).toHaveLength(1);
    expect(observedStates[0]?.diffFiles.map((file) => file.newPath)).toEqual(["src/example.ts"]);
  });

  it("preserves existing diff behavior when no repo config exists", async () => {
    const repoPath = await createTempRepo();

    cloneOrUpdateMock.mockResolvedValue(repoPath);
    getMRDiffMock.mockResolvedValue([
      {
        oldPath: "src/example.ts",
        newPath: "src/example.ts",
        newFile: false,
        deletedFile: false,
        renamedFile: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
      {
        oldPath: "src/other.ts",
        newPath: "src/other.ts",
        newFile: false,
        deletedFile: false,
        renamedFile: false,
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
    ]);

    setPipelineDependenciesForTests({
      gitlabClient: {
        getMRDetails: getMRDetailsMock,
        getMRDiff: getMRDiffMock,
        getMRDiscussions: getMRDiscussionsMock,
        getMRNotes: getMRNotesMock,
        getMRVersions: getMRVersionsMock,
        getMRCommits: getMRCommitsMock,
        getRepositoryCompareDiff: getRepositoryCompareDiffMock,
      } as unknown as PipelineDependencies["gitlabClient"],
      repoManager: {
        cloneOrUpdate: cloneOrUpdateMock,
      } as unknown as PipelineDependencies["repoManager"],
      publisher: {
        postInlineComments: postInlineCommentsMock,
        postSummaryComment: postSummaryCommentMock,
      } as unknown as PipelineDependencies["publisher"],
      runReview: runReviewMock as unknown as PipelineDependencies["runReview"],
      fetchLinkedTickets: fetchLinkedTicketsMock as unknown as PipelineDependencies["fetchLinkedTickets"],
      normalizeFindingsForPublication:
        normalizeFindingsMock as unknown as PipelineDependencies["normalizeFindingsForPublication"],
    });

    await runPipeline(event, manualTrigger);

    expect(observedStates).toHaveLength(1);
    expect(observedStates[0]?.diffFiles.map((file) => file.newPath)).toEqual(["src/example.ts", "src/other.ts"]);
  });
});

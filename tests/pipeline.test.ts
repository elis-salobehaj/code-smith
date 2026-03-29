import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { PipelineDependencies } from "../src/api/pipeline";
import {
  resetPipelineBranchLocksForTests,
  resetPipelineDependenciesForTests,
  runPipeline,
  setPipelineDependenciesForTests,
} from "../src/api/pipeline";
import type { DiffFile, MRCommit, MRDetails, MRVersion } from "../src/gitlab-client/types";
import { HEAD_MARKER_PREFIX, SUMMARY_MARKER } from "../src/publisher/summary-note";

const reviewStatePassthrough = mock(async (state: unknown) => state);
const cloneOrUpdateMock = mock(async () => "/tmp/repo-cache/42-feature%2Fbranch");
const fetchLinkedTicketsMock = mock(async () => []);
const normalizeFindingsMock = mock(async () => []);
const postInlineCommentsMock = mock(async () => ({ posted: 0, failed: 0, skippedDuplicate: 0, skippedUnanchored: 0 }));
const reviewCandidateRepoConfigSecurityMock = mock(async () => ({
  issues: [],
  summary: "",
  droppedUnknownFieldPaths: [],
}));

let summaryNotes: Array<{ id: number; body: string }> = [];
let getMrDetailsCalls = 0;
let firstSummaryRelease: (() => void) | null = null;
let firstSummaryReached!: Promise<void>;
let firstSummaryReachedResolve!: () => void;

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

const diffFiles: DiffFile[] = [
  {
    oldPath: "src/example.ts",
    newPath: "src/example.ts",
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    diff: "@@ -1 +1 @@\n-old\n+new",
  },
];

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

const getMRDetailsMock = mock(async () => {
  getMrDetailsCalls++;
  return mrDetails;
});
const getMRDiffMock = mock(async () => diffFiles);
const getMRDiscussionsMock = mock(async () => []);
const getMRNotesMock = mock(async () => summaryNotes);
const getMRVersionsMock = mock(async () => mrVersions);
const getMRCommitsMock = mock(async () => mrCommits);
const getRepoConfigFileAtRefMock = mock(async () => null);
const getRepositoryCompareDiffMock = mock(async () => diffFiles);
const postConfigSecurityNoteMock = mock(async () => false);
const postSummaryCommentMock = mock(
  async (_projectId: number, _mrIid: number, _verdict: string, _findings: unknown, headSha: string) => {
    summaryNotes = [
      {
        id: 1,
        body: `${SUMMARY_MARKER}\n${HEAD_MARKER_PREFIX}${headSha} -->`,
      },
    ];
    firstSummaryReachedResolve();
    await new Promise<void>((resolve) => {
      firstSummaryRelease = resolve;
    });
  },
);

function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const automaticTrigger = {
  mode: "automatic",
  source: "merge_request_event",
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

describe("runPipeline concurrency", () => {
  beforeEach(() => {
    resetPipelineBranchLocksForTests();
    resetPipelineDependenciesForTests();
    summaryNotes = [];
    getMrDetailsCalls = 0;

    reviewStatePassthrough.mockReset();
    reviewStatePassthrough.mockImplementation(async (state: unknown) => state);

    cloneOrUpdateMock.mockReset();
    cloneOrUpdateMock.mockResolvedValue("/tmp/repo-cache/42-feature%2Fbranch");

    fetchLinkedTicketsMock.mockReset();
    fetchLinkedTicketsMock.mockResolvedValue([]);

    normalizeFindingsMock.mockReset();
    normalizeFindingsMock.mockResolvedValue([]);

    reviewCandidateRepoConfigSecurityMock.mockReset();
    reviewCandidateRepoConfigSecurityMock.mockResolvedValue({ issues: [], summary: "", droppedUnknownFieldPaths: [] });

    postInlineCommentsMock.mockReset();
    postInlineCommentsMock.mockResolvedValue({ posted: 0, failed: 0, skippedDuplicate: 0, skippedUnanchored: 0 });

    getMRDetailsMock.mockReset();
    getMRDetailsMock.mockImplementation(async () => {
      getMrDetailsCalls++;
      return mrDetails;
    });
    getMRDiffMock.mockReset();
    getMRDiffMock.mockResolvedValue(diffFiles);
    getMRDiscussionsMock.mockReset();
    getMRDiscussionsMock.mockResolvedValue([]);
    getMRNotesMock.mockReset();
    getMRNotesMock.mockImplementation(async () => summaryNotes);
    getMRVersionsMock.mockReset();
    getMRVersionsMock.mockResolvedValue(mrVersions);
    getMRCommitsMock.mockReset();
    getMRCommitsMock.mockResolvedValue(mrCommits);
    getRepoConfigFileAtRefMock.mockReset();
    getRepoConfigFileAtRefMock.mockResolvedValue(null);
    getRepositoryCompareDiffMock.mockReset();
    getRepositoryCompareDiffMock.mockResolvedValue(diffFiles);
    postConfigSecurityNoteMock.mockReset();
    postConfigSecurityNoteMock.mockResolvedValue(false);

    const summaryGate = makeDeferred();
    firstSummaryReached = summaryGate.promise;
    firstSummaryReachedResolve = summaryGate.resolve;
    firstSummaryRelease = null;

    postSummaryCommentMock.mockReset();
    postSummaryCommentMock.mockImplementation(
      async (_projectId: number, _mrIid: number, _verdict: string, _findings: unknown, headSha: string) => {
        summaryNotes = [
          {
            id: 1,
            body: `${SUMMARY_MARKER}\n${HEAD_MARKER_PREFIX}${headSha} -->`,
          },
        ];
        firstSummaryReachedResolve();
        await new Promise<void>((resolve) => {
          firstSummaryRelease = resolve;
        });
      },
    );

    setPipelineDependenciesForTests({
      gitlabClient: {
        getMRDetails: getMRDetailsMock,
        getMRDiff: getMRDiffMock,
        getMRDiscussions: getMRDiscussionsMock,
        getMRNotes: getMRNotesMock,
        getMRVersions: getMRVersionsMock,
        getMRCommits: getMRCommitsMock,
        getRepoConfigFileAtRef: getRepoConfigFileAtRefMock,
        getRepositoryCompareDiff: getRepositoryCompareDiffMock,
      } as unknown as PipelineDependencies["gitlabClient"],
      repoManager: {
        cloneOrUpdate: cloneOrUpdateMock,
      } as unknown as PipelineDependencies["repoManager"],
      publisher: {
        postInlineComments: postInlineCommentsMock,
        postConfigSecurityNote: postConfigSecurityNoteMock,
        postSummaryComment: postSummaryCommentMock,
      } as unknown as PipelineDependencies["publisher"],
      runReview: reviewStatePassthrough as unknown as PipelineDependencies["runReview"],
      reviewCandidateRepoConfigSecurity:
        reviewCandidateRepoConfigSecurityMock as unknown as PipelineDependencies["reviewCandidateRepoConfigSecurity"],
      fetchLinkedTickets: fetchLinkedTicketsMock as unknown as PipelineDependencies["fetchLinkedTickets"],
      normalizeFindingsForPublication:
        normalizeFindingsMock as unknown as PipelineDependencies["normalizeFindingsForPublication"],
    });
  });

  it("serializes same-branch runs so the second run re-fetches state after the first summary is written", async () => {
    const firstRun = runPipeline(event, automaticTrigger);
    await firstSummaryReached;

    const secondRun = runPipeline(event, automaticTrigger);
    await Promise.resolve();

    expect(getMrDetailsCalls).toBe(1);
    expect(cloneOrUpdateMock).toHaveBeenCalledTimes(1);
    expect(reviewStatePassthrough).toHaveBeenCalledTimes(1);

    firstSummaryRelease?.();
    await Promise.all([firstRun, secondRun]);

    expect(getMrDetailsCalls).toBe(2);
    expect(cloneOrUpdateMock).toHaveBeenCalledTimes(1);
    expect(reviewStatePassthrough).toHaveBeenCalledTimes(1);
    expect(postSummaryCommentMock).toHaveBeenCalledTimes(1);
  });
});

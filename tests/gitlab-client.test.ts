import { describe, expect, it, mock } from "bun:test";
import { GitLabClient } from "../src/gitlab-client/client";

describe("GitLabClient MR history pagination", () => {
  it("accumulates all MR commit pages", async () => {
    const client = new GitLabClient();
    const allCommits = mock(async (_projectId: number, _mrIid: number, options?: { page?: number }) => {
      if (options?.page === 1) {
        return Array.from({ length: 100 }, (_, index) => ({
          id: `commit-${index}`,
          short_id: `c${index}`,
          title: `commit ${index}`,
          authored_date: "2026-03-20T00:00:00.000Z",
          committed_date: "2026-03-20T00:00:00.000Z",
          parent_ids: [],
        }));
      }

      return [
        {
          id: "commit-100",
          short_id: "c100",
          title: "commit 100",
          authored_date: "2026-03-20T00:00:00.000Z",
          committed_date: "2026-03-20T00:00:00.000Z",
          parent_ids: [],
        },
      ];
    });

    // biome-ignore lint/suspicious/noExplicitAny: test double injection into client internals
    (client as any).api = { MergeRequests: { allCommits } };

    const commits = await client.getMRCommits(1, 2);
    expect(commits).toHaveLength(101);
    expect(allCommits).toHaveBeenCalledTimes(2);
  });

  it("accumulates all MR version pages", async () => {
    const client = new GitLabClient();
    const allDiffVersions = mock(async (_projectId: number, _mrIid: number, options?: { page?: number }) => {
      if (options?.page === 1) {
        return Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          head_commit_sha: `head-${index}`,
          base_commit_sha: `base-${index}`,
          start_commit_sha: `start-${index}`,
          created_at: "2026-03-20T00:00:00.000Z",
        }));
      }

      return [
        {
          id: 101,
          head_commit_sha: "head-100",
          base_commit_sha: "base-100",
          start_commit_sha: "start-100",
          created_at: "2026-03-20T00:00:00.000Z",
        },
      ];
    });

    // biome-ignore lint/suspicious/noExplicitAny: test double injection into client internals
    (client as any).api = { MergeRequests: { allDiffVersions } };

    const versions = await client.getMRVersions(1, 2);
    expect(versions).toHaveLength(101);
    expect(allDiffVersions).toHaveBeenCalledTimes(2);
  });
});

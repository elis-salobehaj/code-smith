import type {
  DiscussionNotePositionBaseSchema,
  DiscussionNotePositionTextSchema,
  DiscussionNoteSchema,
  MergeRequestDiffSchema,
} from "@gitbeaker/core";
import { Gitlab } from "@gitbeaker/rest";
import { config } from "../config";
import { REPO_CONFIG_FILENAMES } from "../config/repo-config";
import { type CheckpointRecord, findLatestSuccessfulCheckpoint } from "../publisher/checkpoint";
import type { DiffFile, Discussion, MRCommit, MRDetails, MRVersion, Note, NotePosition } from "./types";

export class GitLabClient {
  private api: InstanceType<typeof Gitlab>;

  constructor() {
    this.api = new Gitlab({
      host: config.GITLAB_URL,
      token: config.GITLAB_TOKEN,
    });
  }

  private async getAllPages<T>(loader: (page: number) => Promise<T[]>): Promise<T[]> {
    const allItems: T[] = [];
    let page = 1;

    while (true) {
      const items = await loader(page);
      allItems.push(...items);

      if (items.length < 100) {
        return allItems;
      }

      page++;
    }
  }

  private getErrorStatus(error: unknown): number | null {
    if (!error || typeof error !== "object") {
      return null;
    }

    if ("statusCode" in error && typeof error.statusCode === "number") {
      return error.statusCode;
    }

    if ("cause" in error && error.cause && typeof error.cause === "object") {
      const cause = error.cause;
      if ("response" in cause && cause.response && typeof cause.response === "object") {
        const response = cause.response;
        if ("status" in response && typeof response.status === "number") {
          return response.status;
        }
      }
    }

    if ("response" in error && error.response && typeof error.response === "object") {
      const response = error.response;
      if ("status" in response && typeof response.status === "number") {
        return response.status;
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // MR metadata
  // ---------------------------------------------------------------------------

  async getMRDetails(projectId: number, mrIid: number): Promise<MRDetails> {
    // gitbeaker v43 returns snake_case response fields. Some fields are typed as
    // `string | Camelize<unknown>` due to the Record<string, unknown> extension
    // on schema interfaces. We access the known snake_case keys and narrow via
    // String() where the union type would otherwise block assignment.
    const mr = await this.api.MergeRequests.show(projectId, mrIid);
    const diffRefs = mr.diff_refs as (DiscussionNotePositionBaseSchema & { start_sha: string }) | undefined;

    return {
      id: mr.id,
      iid: mr.iid,
      projectId,
      title: String(mr.title),
      description: mr.description != null ? String(mr.description) : null,
      sourceBranch: String(mr.source_branch),
      targetBranch: String(mr.target_branch),
      state: String(mr.state),
      webUrl: String(mr.web_url),
      authorUsername: String(mr.author.username),
      headSha: diffRefs?.head_sha ?? "",
      baseSha: diffRefs?.base_sha ?? "",
      startSha: diffRefs?.start_sha ?? "",
    };
  }

  // ---------------------------------------------------------------------------
  // Diff files
  // allDiffs() returns the MR diffs directly and avoids the deprecated
  // showChanges() helper.
  // ---------------------------------------------------------------------------

  async getMRDiff(projectId: number, mrIid: number): Promise<DiffFile[]> {
    const changes = (await this.api.MergeRequests.allDiffs(projectId, mrIid)) as unknown as MergeRequestDiffSchema[];

    return changes.map((c) => ({
      oldPath: c.old_path,
      newPath: c.new_path,
      newFile: c.new_file,
      deletedFile: c.deleted_file,
      renamedFile: c.renamed_file,
      diff: c.diff,
    }));
  }

  async getRepositoryCompareDiff(projectId: number, from: string, to: string): Promise<DiffFile[]> {
    const compare = (await this.api.Repositories.compare(projectId, from, to)) as {
      diffs?: Array<{
        old_path: string;
        new_path: string;
        new_file: boolean;
        deleted_file: boolean;
        renamed_file: boolean;
        diff: string;
      }>;
    };

    return (compare.diffs ?? []).map((diff) => ({
      oldPath: diff.old_path,
      newPath: diff.new_path,
      newFile: diff.new_file,
      deletedFile: diff.deleted_file,
      renamedFile: diff.renamed_file,
      diff: diff.diff,
    }));
  }

  async getMRCommits(projectId: number, mrIid: number): Promise<MRCommit[]> {
    const commits = await this.getAllPages((page) =>
      this.api.MergeRequests.allCommits(projectId, mrIid, {
        page,
        perPage: 100,
      }),
    );

    return commits.map((commit) => ({
      id: String(commit.id),
      shortId: String(commit.short_id),
      title: String(commit.title),
      authoredDate: String(commit.authored_date),
      committedDate: String(commit.committed_date),
      parentIds: Array.isArray(commit.parent_ids) ? commit.parent_ids.map((parentId) => String(parentId)) : [],
    }));
  }

  async getMRVersions(projectId: number, mrIid: number): Promise<MRVersion[]> {
    const versions = await this.getAllPages((page) =>
      // biome-ignore lint/suspicious/noExplicitAny: GitBeaker's allDiffVersions typing is narrower than the runtime API options it accepts
      this.api.MergeRequests.allDiffVersions(projectId, mrIid, { page, perPage: 100 } as any),
    );

    return versions.map((version) => ({
      id: Number(version.id),
      headCommitSha: String(version.head_commit_sha),
      baseCommitSha: String(version.base_commit_sha),
      startCommitSha: String(version.start_commit_sha),
      createdAt: String(version.created_at),
    }));
  }

  // ---------------------------------------------------------------------------
  // Discussions (inline + MR-level notes with position data)
  // all() verified via Bun runtime inspection on MergeRequestDiscussions.
  // DiscussionNoteSchema fields are snake_case in responses.
  // ---------------------------------------------------------------------------

  async getMRDiscussions(projectId: number, mrIid: number): Promise<Discussion[]> {
    const discussions = await this.api.MergeRequestDiscussions.all(projectId, mrIid);

    return discussions.map((d) => ({
      id: d.id,
      notes: ((d.notes ?? []) as unknown as DiscussionNoteSchema[]).map((n): Note => {
        // n.position is typed as DiscussionNotePositionOptions (camelCase options type)
        // but at runtime the response arrives as snake_case per DiscussionNotePositionBaseSchema.
        const pos = n.position as (DiscussionNotePositionBaseSchema & DiscussionNotePositionTextSchema) | undefined;

        const position: NotePosition | undefined =
          pos != null
            ? {
                baseSha: pos.base_sha,
                startSha: pos.start_sha,
                headSha: pos.head_sha,
                positionType: "text",
                newPath: pos.new_path ?? "",
                newLine: pos.new_line != null ? Number(pos.new_line) : null,
                oldPath: pos.old_path ?? "",
                oldLine: pos.old_line != null ? Number(pos.old_line) : null,
              }
            : undefined;

        return {
          id: n.id,
          body: n.body,
          authorUsername: n.author.username,
          createdAt: n.created_at,
          position,
          resolvable: n.resolvable,
          resolved: n.resolved as boolean | undefined,
        };
      }),
    }));
  }

  // ---------------------------------------------------------------------------
  // Post a new MR-level note (summary comment)
  // Verified method: MergeRequestNotes.create(projectId, mrIid, body)
  // ---------------------------------------------------------------------------

  async createMRNote(projectId: number, mrIid: number, body: string): Promise<void> {
    await this.api.MergeRequestNotes.create(projectId, mrIid, body);
  }

  // ---------------------------------------------------------------------------
  // Fetch all MR-level notes (top-level, non-inline).
  // Used by the publisher to check for existing summary notes before posting.
  // Returns minimal {id, body} pairs — callers that need full Note shape should
  // use getMRDiscussions instead.
  // ---------------------------------------------------------------------------

  async getMRNotes(projectId: number, mrIid: number): Promise<Array<{ id: number; body: string }>> {
    const notes = await this.api.MergeRequestNotes.all(projectId, mrIid);
    return notes.map((n) => ({
      id: Number(n.id),
      body: String(n.body),
    }));
  }

  async getRepositoryFileTextAtRef(projectId: number, filePath: string, ref: string): Promise<string | null> {
    try {
      const rawFile = await this.api.RepositoryFiles.showRaw(projectId, filePath, ref);
      return typeof rawFile === "string" ? rawFile : await rawFile.text();
    } catch (error) {
      if (this.getErrorStatus(error) === 404) {
        return null;
      }

      throw error;
    }
  }

  async getRepoConfigFileAtRef(
    projectId: number,
    ref: string,
  ): Promise<{ fileName: (typeof REPO_CONFIG_FILENAMES)[number]; rawText: string } | null> {
    for (const fileName of REPO_CONFIG_FILENAMES) {
      const rawText = await this.getRepositoryFileTextAtRef(projectId, fileName, ref);
      if (rawText !== null) {
        return { fileName, rawText };
      }
    }

    return null;
  }

  async getCheckpointRecord(projectId: number, mrIid: number): Promise<CheckpointRecord | null> {
    const notes = await this.getMRNotes(projectId, mrIid);
    return findLatestSuccessfulCheckpoint(notes);
  }

  // ---------------------------------------------------------------------------
  // Create an inline discussion on a specific line.
  // Verified method: MergeRequestDiscussions.create(projectId, mrIid, body, opts)
  // The position option is typed as Camelize<DiscussionNotePositionSchema>,
  // so option keys are camelCase (baseSha, headSha, positionType, newPath, newLine).
  // ---------------------------------------------------------------------------

  async createInlineDiscussion(
    projectId: number,
    mrIid: number,
    body: string,
    position: {
      baseSha: string;
      startSha: string;
      headSha: string;
      newPath: string;
      newLine: number;
    },
  ): Promise<void> {
    await this.api.MergeRequestDiscussions.create(projectId, mrIid, body, {
      position: {
        baseSha: position.baseSha,
        startSha: position.startSha,
        headSha: position.headSha,
        positionType: "text" as const,
        newPath: position.newPath,
        newLine: String(position.newLine),
      },
    });
  }
}

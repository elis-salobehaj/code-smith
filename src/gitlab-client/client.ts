import type {
  DiscussionNotePositionBaseSchema,
  DiscussionNotePositionTextSchema,
  DiscussionNoteSchema,
  MergeRequestDiffSchema,
} from "@gitbeaker/core";
import { Gitlab } from "@gitbeaker/rest";
import { config } from "../config";
import type { DiffFile, Discussion, MRDetails, Note, NotePosition } from "./types";

export class GitLabClient {
  private api: InstanceType<typeof Gitlab>;

  constructor() {
    this.api = new Gitlab({
      host: config.GITLAB_URL,
      token: config.GITLAB_TOKEN,
    });
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

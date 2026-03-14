// ---------------------------------------------------------------------------
// GitLab domain types used throughout the application.
// These are hand-shaped interfaces over the raw @gitbeaker/rest responses —
// only the fields we actually use are declared, keeping the surface minimal.
// ---------------------------------------------------------------------------

export interface MRDetails {
  id: number;
  iid: number;
  projectId: number;
  title: string;
  description: string | null;
  sourceBranch: string;
  targetBranch: string;
  state: string;
  webUrl: string;
  authorUsername: string;
  /** SHA of the HEAD commit of the source branch at review time. */
  headSha: string;
  /** Common ancestor SHA used for diff_refs. */
  baseSha: string;
  /** Start SHA used for diff_refs. */
  startSha: string;
}

export interface DiffHunk {
  header: string;
  lines: string;
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  /** True when the file was added in this MR. */
  newFile: boolean;
  /** True when the file was deleted in this MR. */
  deletedFile: boolean;
  /** True when only the path changed (rename). */
  renamedFile: boolean;
  diff: string;
}

export interface NotePosition {
  baseSha: string;
  startSha: string;
  headSha: string;
  positionType: "text";
  newPath: string;
  newLine: number | null;
  oldPath: string;
  oldLine: number | null;
}

export interface Note {
  id: number;
  body: string;
  authorUsername: string;
  createdAt: string;
  /** Present on inline notes; undefined for MR-level notes. */
  position?: NotePosition;
  resolvable: boolean;
  resolved?: boolean;
}

export interface Discussion {
  id: string;
  notes: Note[];
}

import { z } from "zod";
import type { Discussion, Note } from "../gitlab-client/types";

export const CHECKPOINT_MARKER_OPEN = "<!-- code-smith:review-run";
export const CHECKPOINT_FORMAT_VERSION = "1";

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const boolStringSchema = z.enum(["true", "false"]);

const checkpointMarkerSchema = z.object({
  format_version: z.literal(CHECKPOINT_FORMAT_VERSION),
  status: z.enum(["success", "failed", "partial"]),
  trigger: z.enum(["automatic", "manual"]),
  range_start_sha: shaSchema,
  range_end_sha: shaSchema,
  mr_version_id: z.coerce.number().int().positive(),
  published_inline: boolStringSchema,
  published_summary: boolStringSchema,
  run_id: z.string().min(1),
  timestamp: z.string().datetime(),
  source: z.enum(["merge_request_event", "mr_note_command"]).optional(),
});

export interface CheckpointRecord {
  formatVersion: "1";
  status: "success" | "failed" | "partial";
  trigger: "automatic" | "manual";
  rangeStartSha: string;
  rangeEndSha: string;
  mrVersionId: number;
  publishedInline: boolean;
  publishedSummary: boolean;
  runId: string;
  timestamp: string;
  source?: "merge_request_event" | "mr_note_command";
}

export interface CheckpointSummaryContext {
  status: CheckpointRecord["status"];
  trigger: CheckpointRecord["trigger"];
  rangeStartSha: string;
  rangeEndSha: string;
  mrVersionId: number;
  publishedInline: boolean;
  publishedSummary: boolean;
  runId: string;
  timestamp: string;
  source?: CheckpointRecord["source"];
}

// Operational note: to reset checkpoints for an MR, delete CodeSmith summary
// notes containing code-smith:review-run markers in GitLab. The next automatic
// run will fall back to a full review because no valid successful checkpoint
// will remain.
export function buildCheckpointMarker(context: CheckpointSummaryContext): string {
  const lines = [
    CHECKPOINT_MARKER_OPEN,
    `format_version=${CHECKPOINT_FORMAT_VERSION}`,
    `status=${context.status}`,
    `trigger=${context.trigger}`,
    `range_start_sha=${context.rangeStartSha}`,
    `range_end_sha=${context.rangeEndSha}`,
    `mr_version_id=${context.mrVersionId}`,
    `published_inline=${String(context.publishedInline)}`,
    `published_summary=${String(context.publishedSummary)}`,
    `run_id=${context.runId}`,
    `timestamp=${context.timestamp}`,
  ];

  if (context.source) {
    lines.push(`source=${context.source}`);
  }

  lines.push("-->");
  return lines.join("\n");
}

export function parseCheckpointMarker(noteBody: string): CheckpointRecord | null {
  const match = noteBody.match(/<!-- code-smith:review-run\n([\s\S]*?)\n-->/);
  if (!match) {
    return null;
  }

  const markerBody = match[1]?.trim();
  if (!markerBody) {
    return null;
  }

  const rawEntries = markerBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const equalsIndex = line.indexOf("=");
      if (equalsIndex === -1) {
        return null;
      }

      return [line.slice(0, equalsIndex), line.slice(equalsIndex + 1)] as const;
    });

  if (rawEntries.some((entry) => entry === null)) {
    return null;
  }

  const raw = Object.fromEntries(rawEntries as Array<readonly [string, string]>);
  if (raw.format_version !== CHECKPOINT_FORMAT_VERSION) {
    return null;
  }

  const parsed = checkpointMarkerSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  return {
    formatVersion: parsed.data.format_version,
    status: parsed.data.status,
    trigger: parsed.data.trigger,
    rangeStartSha: parsed.data.range_start_sha,
    rangeEndSha: parsed.data.range_end_sha,
    mrVersionId: parsed.data.mr_version_id,
    publishedInline: parsed.data.published_inline === "true",
    publishedSummary: parsed.data.published_summary === "true",
    runId: parsed.data.run_id,
    timestamp: parsed.data.timestamp,
    source: parsed.data.source,
  };
}

export function findLatestSuccessfulCheckpoint(notes: ReadonlyArray<{ body: string }>): CheckpointRecord | null {
  const checkpoints = notes
    .map((note) => parseCheckpointMarker(note.body))
    .filter((checkpoint): checkpoint is CheckpointRecord => checkpoint !== null)
    .filter((checkpoint) => checkpoint.status === "success")
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));

  return checkpoints[0] ?? null;
}

export function flattenDiscussionNotes(discussions: Discussion[]): Note[] {
  return discussions.flatMap((discussion) => discussion.notes);
}

export function findLatestSuccessfulCheckpointInDiscussions(discussions: Discussion[]): CheckpointRecord | null {
  return findLatestSuccessfulCheckpoint(flattenDiscussionNotes(discussions));
}

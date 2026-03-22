import type { MRCommit } from "../gitlab-client/types";
import type { CheckpointRecord } from "../publisher/checkpoint";

export interface ReviewRange {
  rangeStart: string;
  rangeEnd: string;
  mode: "full" | "incremental" | "skip";
}

export function selectReviewRange(
  checkpoint: CheckpointRecord | null,
  mrCommits: MRCommit[],
  currentHeadSha: string,
  fullRangeStartSha: string,
): ReviewRange {
  if (!checkpoint) {
    return {
      rangeStart: fullRangeStartSha,
      rangeEnd: currentHeadSha,
      mode: "full",
    };
  }

  if (checkpoint.rangeEndSha === currentHeadSha) {
    return {
      rangeStart: checkpoint.rangeEndSha,
      rangeEnd: currentHeadSha,
      mode: "skip",
    };
  }

  const currentCommitShas = new Set(mrCommits.map((commit) => commit.id));
  if (!currentCommitShas.has(checkpoint.rangeEndSha)) {
    return {
      rangeStart: fullRangeStartSha,
      rangeEnd: currentHeadSha,
      mode: "full",
    };
  }

  return {
    rangeStart: checkpoint.rangeEndSha,
    rangeEnd: currentHeadSha,
    mode: "incremental",
  };
}

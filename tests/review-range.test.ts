import { describe, expect, it } from "bun:test";
import { selectReviewRange } from "../src/agents/review-range";
import type { CheckpointRecord } from "../src/publisher/checkpoint";

const currentHeadSha = "05fef636ef4e5feb8bd54ebe7a29d3554eca4c48";
const mr16Commits = [
  {
    id: "366c875bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    shortId: "366c875",
    title: "c1",
    authoredDate: "",
    committedDate: "",
    parentIds: [],
  },
  {
    id: "9674c052cccccccccccccccccccccccccccccccc",
    shortId: "9674c05",
    title: "c2",
    authoredDate: "",
    committedDate: "",
    parentIds: [],
  },
  {
    id: "19447d5fdddddddddddddddddddddddddddddddd",
    shortId: "19447d5",
    title: "c3",
    authoredDate: "",
    committedDate: "",
    parentIds: [],
  },
  { id: currentHeadSha, shortId: "05fef63", title: "c4", authoredDate: "", committedDate: "", parentIds: [] },
];

function makeCheckpoint(rangeEndSha: string): CheckpointRecord {
  return {
    formatVersion: "1",
    status: "success",
    trigger: "automatic",
    rangeStartSha: rangeEndSha,
    rangeEndSha,
    mrVersionId: 1,
    publishedInline: true,
    publishedSummary: true,
    runId: "run-1",
    timestamp: "2026-03-20T00:00:00.000Z",
    source: "merge_request_event",
  };
}

describe("selectReviewRange", () => {
  it("returns full mode when no prior successful checkpoint exists", () => {
    expect(selectReviewRange(null, mr16Commits, currentHeadSha, "base-start-sha")).toEqual({
      rangeStart: "base-start-sha",
      rangeEnd: currentHeadSha,
      mode: "full",
    });
  });

  it("returns incremental mode from the last reviewed head to the current head", () => {
    expect(
      selectReviewRange(
        makeCheckpoint("19447d5fdddddddddddddddddddddddddddddddd"),
        mr16Commits,
        currentHeadSha,
        "base-start-sha",
      ),
    ).toEqual({
      rangeStart: "19447d5fdddddddddddddddddddddddddddddddd",
      rangeEnd: currentHeadSha,
      mode: "incremental",
    });
  });

  it("returns skip mode when the checkpoint end SHA already matches the current head", () => {
    expect(selectReviewRange(makeCheckpoint(currentHeadSha), mr16Commits, currentHeadSha, "base-start-sha")).toEqual({
      rangeStart: currentHeadSha,
      rangeEnd: currentHeadSha,
      mode: "skip",
    });
  });

  it("falls back to full mode when history was rewritten and the checkpoint SHA is absent", () => {
    expect(
      selectReviewRange(
        makeCheckpoint("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        mr16Commits,
        currentHeadSha,
        "base-start-sha",
      ),
    ).toEqual({
      rangeStart: "base-start-sha",
      rangeEnd: currentHeadSha,
      mode: "full",
    });
  });
});

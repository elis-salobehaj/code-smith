import { describe, expect, it } from "bun:test";
import { findAutomaticReviewSkipSummary } from "../src/api/pipeline";
import type { ReviewTriggerContext } from "../src/api/trigger";

const automaticTrigger: ReviewTriggerContext = {
  mode: "automatic",
  source: "merge_request_event",
};

const manualTrigger: ReviewTriggerContext = {
  mode: "manual",
  source: "mr_note_command",
  noteId: 101,
  rawCommand: "/ai-review",
};

describe("findAutomaticReviewSkipSummary", () => {
  it("returns the matching summary note for automatic same-head reruns", () => {
    const existingSummary = {
      id: 57110,
      body: [
        "<!-- code-smith:summary -->",
        "## review",
        "",
        "<!-- code-smith:head sha=05fef636ef4e5feb8bd54ebe7a29d3554eca4c48 -->",
      ].join("\n"),
    };

    expect(
      findAutomaticReviewSkipSummary(automaticTrigger, [existingSummary], "05fef636ef4e5feb8bd54ebe7a29d3554eca4c48"),
    ).toEqual(existingSummary);
  });

  it("does not skip manual reruns even when the current head already has a summary note", () => {
    expect(
      findAutomaticReviewSkipSummary(
        manualTrigger,
        [
          {
            id: 57110,
            body: [
              "<!-- code-smith:summary -->",
              "## review",
              "",
              "<!-- code-smith:head sha=05fef636ef4e5feb8bd54ebe7a29d3554eca4c48 -->",
            ].join("\n"),
          },
        ],
        "05fef636ef4e5feb8bd54ebe7a29d3554eca4c48",
      ),
    ).toBeNull();
  });

  it("does not skip automatic review when the summary note belongs to a different head", () => {
    expect(
      findAutomaticReviewSkipSummary(
        automaticTrigger,
        [
          {
            id: 57110,
            body: ["<!-- code-smith:summary -->", "## review", "", "<!-- code-smith:head sha=deadbeef -->"].join(
              "\n",
            ),
          },
        ],
        "05fef636ef4e5feb8bd54ebe7a29d3554eca4c48",
      ),
    ).toBeNull();
  });
});

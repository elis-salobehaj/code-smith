// ---------------------------------------------------------------------------
// Phase 3 — Agent tests
//
// Strategy:
//  • Pure utility functions (prompt builders, JSON parsers, extractFindings)
//    are imported via static imports and tested without any mocking — they
//    carry the most logic and deserve the highest test coverage.
//  • The orchestrator (runReview) is tested via mock.module + top-level
//    dynamic import so that the real LLM is never invoked in CI.
// ---------------------------------------------------------------------------

import { describe, expect, it, mock } from "bun:test";
// Pure utility function imports — no LLM calls happen from these paths.
import { buildContextPrompt, parseContextResponse } from "../src/agents/context-agent";
import { buildInvestigatorPrompt, extractFindings } from "../src/agents/investigator-agent";
import { loadAgentPrompt, loadPromptConfig } from "../src/agents/prompt-loader";
import type { AgentMessage } from "../src/agents/protocol";
import { textMessage } from "../src/agents/protocol";
import { buildReflectionPrompt, parseReflectionResponse } from "../src/agents/reflection-agent";
import type { ReviewState } from "../src/agents/state";
import { parseDiffHunks } from "../src/context/diff-parser";

// ---------------------------------------------------------------------------
// Orchestrator mock setup — MUST come before the dynamic import of orchestrator
// so that mock.module intercepts when orchestrator first imports the agents.
// ---------------------------------------------------------------------------

const mockContextAgent = mock(
  async (s: ReviewState): Promise<ReviewState> => ({
    ...s,
    mrIntent: "mocked intent",
    changeCategories: ["mocked"],
    riskAreas: ["mocked risk"],
  }),
);
const mockInvestigatorLoop = mock(async (s: ReviewState): Promise<ReviewState> => ({ ...s, rawFindings: [] }));
const mockReflectionAgent = mock(
  async (s: ReviewState): Promise<ReviewState> => ({
    ...s,
    verifiedFindings: [],
    summaryVerdict: "APPROVE",
    needsReinvestigation: false,
  }),
);

mock.module("../src/agents/context-agent", () => ({ contextAgent: mockContextAgent }));
mock.module("../src/agents/investigator-agent", () => ({ investigatorLoop: mockInvestigatorLoop }));
mock.module("../src/agents/reflection-agent", () => ({ reflectionAgent: mockReflectionAgent }));

// Dynamic import AFTER mock.module so the orchestrator's agent imports are mocked.
const { runReview, deduplicateFindings } = await import("../src/agents/orchestrator");

// ---------------------------------------------------------------------------
// Shared test fixture helpers
// ---------------------------------------------------------------------------

function makeMRDetails() {
  return {
    id: 1,
    iid: 42,
    projectId: 99,
    title: "feat: add payment gateway",
    description: "Integrates Stripe for subscription billing.",
    sourceBranch: "feat/stripe",
    targetBranch: "main",
    state: "opened",
    webUrl: "https://gitlab.example.com/project/-/merge_requests/42",
    authorUsername: "alice",
    headSha: "abc123",
    baseSha: "def456",
    startSha: "ghi789",
  };
}

function makeDiffFile(path = "src/billing.ts") {
  return {
    oldPath: path,
    newPath: path,
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    diff: "@@ -1,3 +1,5 @@\n-const x = 1;\n+const x = 2;\n+const y = 3;\n",
  };
}

function makeBaseState(): ReviewState {
  const diffFiles = [makeDiffFile()];
  return {
    mrDetails: makeMRDetails(),
    diffFiles,
    diffHunks: parseDiffHunks(diffFiles),
    repoPath: "/tmp/test-repo",
    triggerContext: { mode: "automatic", source: "merge_request_event" },
    mrIntent: "Add Stripe payment integration for subscriptions.",
    changeCategories: ["billing", "API"],
    riskAreas: ["Check if webhook signature validation is implemented."],
    rawFindings: [],
    verifiedFindings: [],
    summaryVerdict: "APPROVE",
    messages: [],
    reinvestigationCount: 0,
    needsReinvestigation: false,
  };
}

/**
 * Build a minimal valid AgentMessage fixture.
 */
function makeTextMessage(text: string): AgentMessage {
  return text ? textMessage("assistant", text) : { role: "assistant", content: [] };
}

// ---------------------------------------------------------------------------
// context-agent — pure function tests
// ---------------------------------------------------------------------------

describe("prompt loader", () => {
  it("loads YAML prompt config and renders structured sections for all agents", () => {
    const config = loadPromptConfig();

    expect(config.context_agent.role.length).toBeGreaterThan(0);
    expect(config.investigator_agent.instructions.length).toBeGreaterThan(0);
    expect(config.reflection_agent.output_schema.length).toBeGreaterThan(0);

    const rendered = loadAgentPrompt("reflection_agent");
    expect(rendered).toContain("<role>");
    expect(rendered).toContain("</role>");
    expect(rendered).toContain("<context>");
    expect(rendered).toContain("<instructions>");
    expect(rendered).toContain("<constraints>");
    expect(rendered).toContain("<output_schema>");
  });
});

describe("buildContextPrompt", () => {
  it("includes MR title and description", () => {
    const prompt = buildContextPrompt(makeBaseState());
    expect(prompt).toContain("feat: add payment gateway");
    expect(prompt).toContain("Integrates Stripe for subscription billing.");
  });

  it("includes author and branch info", () => {
    const prompt = buildContextPrompt(makeBaseState());
    expect(prompt).toContain("alice");
    expect(prompt).toContain("feat/stripe → main");
  });

  it("includes diff content", () => {
    const prompt = buildContextPrompt(makeBaseState());
    expect(prompt).toContain("src/billing.ts");
    expect(prompt).toContain("+const x = 2;");
  });

  it("truncates oversized diffs to 8000 chars", () => {
    const state = {
      ...makeBaseState(),
      diffFiles: [{ ...makeDiffFile(), diff: "x".repeat(20_000) }],
    };
    const prompt = buildContextPrompt(state);
    expect(prompt.length).toBeLessThan(8_500);
  });

  it("falls back to (none) when description is null", () => {
    const state = {
      ...makeBaseState(),
      mrDetails: { ...makeMRDetails(), description: null },
    };
    const prompt = buildContextPrompt(state);
    expect(prompt).toContain("(none)");
  });
});

describe("parseContextResponse", () => {
  it("parses a valid JSON response", () => {
    const json = JSON.stringify({
      intent: "Add payment processing",
      categories: ["billing", "API"],
      riskHypotheses: ["Check webhook validation"],
    });
    const result = parseContextResponse(makeTextMessage(json));
    expect(result.intent).toBe("Add payment processing");
    expect(result.categories).toEqual(["billing", "API"]);
    expect(result.riskHypotheses).toEqual(["Check webhook validation"]);
  });

  it("handles empty arrays", () => {
    const json = JSON.stringify({ intent: "Trivial refactor", categories: [], riskHypotheses: [] });
    const result = parseContextResponse(makeTextMessage(json));
    expect(result.categories).toEqual([]);
    expect(result.riskHypotheses).toEqual([]);
  });

  it("throws when content is empty (no text block)", () => {
    expect(() => parseContextResponse(makeTextMessage(""))).toThrow("no text block");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseContextResponse(makeTextMessage("not json"))).toThrow("unparseable JSON");
  });

  it("throws on schema mismatch (missing intent)", () => {
    const json = JSON.stringify({ categories: [], riskHypotheses: [] });
    expect(() => parseContextResponse(makeTextMessage(json))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// investigator-agent — pure function tests
// ---------------------------------------------------------------------------

describe("buildInvestigatorPrompt", () => {
  it("includes MR intent", () => {
    const prompt = buildInvestigatorPrompt(makeBaseState());
    expect(prompt).toContain("Add Stripe payment integration for subscriptions.");
  });

  it("includes numbered risk hypotheses", () => {
    const prompt = buildInvestigatorPrompt(makeBaseState());
    expect(prompt).toContain("1. Check if webhook signature validation is implemented.");
  });

  it("falls back when riskAreas is empty", () => {
    const state = { ...makeBaseState(), riskAreas: [] };
    const prompt = buildInvestigatorPrompt(state);
    expect(prompt).toContain("none");
  });

  it("includes structured hunk content for diff files", () => {
    const prompt = buildInvestigatorPrompt(makeBaseState());
    expect(prompt).toContain("src/billing.ts");
    expect(prompt).toContain("HUNK 1");
    expect(prompt).toContain("const x = 2");
  });

  it("shows fallback when diffHunks is empty", () => {
    const state = { ...makeBaseState(), diffHunks: [] };
    const prompt = buildInvestigatorPrompt(state);
    expect(prompt).toContain("no structured hunks available");
  });
});

describe("extractFindings", () => {
  const validFindingJson = JSON.stringify([
    {
      file: "src/billing.ts",
      lineStart: 10,
      lineEnd: 15,
      riskLevel: "high",
      title: "Missing webhook signature check",
      description: "Stripe webhook is not validated.",
      evidence: "Line 12: no Stripe-Signature header check.",
      suggestedFix: "Add stripe.webhooks.constructEvent() validation.",
    },
  ]);

  it("returns [] for empty message history", () => {
    expect(extractFindings([])).toEqual([]);
  });

  it("returns [] when no assistant message exists", () => {
    const messages: AgentMessage[] = [textMessage("user", "hello")];
    expect(extractFindings(messages)).toEqual([]);
  });

  it("returns [] when assistant message has no text block", () => {
    const messages: AgentMessage[] = [
      { role: "assistant", content: [{ type: "tool_call", id: "tu1", name: "read_file", input: {} }] },
    ];
    expect(extractFindings(messages)).toEqual([]);
  });

  it("parses a raw JSON array from assistant message", () => {
    const messages: AgentMessage[] = [makeTextMessage(validFindingJson)];
    const findings = extractFindings(messages);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("src/billing.ts");
    expect(findings[0].riskLevel).toBe("high");
  });

  it("parses a JSON array wrapped in ```json fences", () => {
    const fenced = `\`\`\`json\n${validFindingJson}\n\`\`\``;
    const messages: AgentMessage[] = [makeTextMessage(fenced)];
    const findings = extractFindings(messages);
    expect(findings).toHaveLength(1);
  });

  it("returns [] for an empty JSON array", () => {
    const messages: AgentMessage[] = [makeTextMessage("[]")];
    expect(extractFindings(messages)).toEqual([]);
  });

  it("returns [] when JSON array fails schema validation", () => {
    const bad = JSON.stringify([{ file: "foo.ts" }]); // missing required fields
    const messages: AgentMessage[] = [makeTextMessage(bad)];
    expect(extractFindings(messages)).toEqual([]);
  });

  it("uses the most recent assistant message", () => {
    const oldMsg: AgentMessage = makeTextMessage("[]");
    const newMsg: AgentMessage = makeTextMessage(validFindingJson);
    // extractFindings walks backwards — newMsg (last) is checked first
    const findings = extractFindings([oldMsg, textMessage("user", "ok"), newMsg]);
    expect(findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// parseDiffHunks — pure parser tests
// ---------------------------------------------------------------------------

describe("parseDiffHunks", () => {
  it("returns empty array for empty input", () => {
    expect(parseDiffHunks([])).toEqual([]);
  });

  it("parses a basic hunk with added and removed lines", () => {
    const result = parseDiffHunks([makeDiffFile()]);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("src/billing.ts");
    expect(result[0].hunkIndex).toBe(1);
    expect(result[0].newLineStart).toBe(1);
    expect(result[0].newLineEnd).toBe(2);
    expect(result[0].addedLines).toHaveLength(2);
    expect(result[0].addedLines[0]).toEqual({ lineNumber: 1, content: "const x = 2;" });
    expect(result[0].removedLines).toHaveLength(1);
    expect(result[0].removedLines[0]).toEqual({ content: "const x = 1;" });
  });

  it("skips deleted files", () => {
    const deletedFile = { ...makeDiffFile(), deletedFile: true };
    expect(parseDiffHunks([deletedFile])).toHaveLength(0);
  });

  it("assigns sequential hunkIndex values for multiple hunks in one file", () => {
    const twoHunkDiff = "@@ -1,2 +1,2 @@\n-old1\n+new1\n@@ -5,2 +5,2 @@\n-old2\n+new2\n";
    const result = parseDiffHunks([{ ...makeDiffFile(), diff: twoHunkDiff }]);
    expect(result).toHaveLength(2);
    expect(result[0].hunkIndex).toBe(1);
    expect(result[1].hunkIndex).toBe(2);
  });

  it("produces separate hunks for separate files", () => {
    const result = parseDiffHunks([makeDiffFile("src/a.ts"), makeDiffFile("src/b.ts")]);
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe("src/a.ts");
    expect(result[1].file).toBe("src/b.ts");
  });
});

// ---------------------------------------------------------------------------
// deduplicateFindings — orchestrator post-processor tests
// ---------------------------------------------------------------------------

describe("deduplicateFindings", () => {
  const base = {
    file: "src/foo.ts",
    lineStart: 10,
    lineEnd: 12,
    riskLevel: "high" as const,
    title: "Bug in foo",
    description: "Something is wrong.",
    evidence: "Line 10: bad code",
  };

  it("returns empty array unchanged", () => {
    expect(deduplicateFindings([])).toEqual([]);
  });

  it("returns a single finding unchanged", () => {
    expect(deduplicateFindings([base])).toEqual([base]);
  });

  it("removes exact duplicate (same file + start + end + title)", () => {
    const result = deduplicateFindings([base, { ...base }]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Bug in foo");
  });

  it("merges overlapping ranges in the same file", () => {
    const a = { ...base, lineStart: 10, lineEnd: 13, riskLevel: "high" as const };
    const b = { ...base, lineStart: 12, lineEnd: 16, riskLevel: "medium" as const, title: "Second issue" };
    const result = deduplicateFindings([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].lineStart).toBe(10);
    expect(result[0].lineEnd).toBe(16);
    expect(result[0].riskLevel).toBe("high");
  });

  it("uses highest risk level when merging", () => {
    const a = { ...base, lineStart: 10, lineEnd: 12, riskLevel: "low" as const };
    const b = { ...base, lineStart: 11, lineEnd: 14, riskLevel: "critical" as const, title: "Critical issue" };
    const result = deduplicateFindings([a, b]);
    expect(result[0].riskLevel).toBe("critical");
  });

  it("keeps non-overlapping findings in the same file separate", () => {
    const a = { ...base, lineStart: 10, lineEnd: 12 };
    const b = { ...base, lineStart: 20, lineEnd: 22, title: "Different issue" };
    const result = deduplicateFindings([a, b]);
    expect(result).toHaveLength(2);
  });

  it("keeps findings in different files separate even with the same line range", () => {
    const a = { ...base, file: "src/foo.ts" };
    const b = { ...base, file: "src/bar.ts" };
    const result = deduplicateFindings([a, b]);
    expect(result).toHaveLength(2);
  });

  it("handles three findings where two overlap and one is separate", () => {
    const a = { ...base, lineStart: 10, lineEnd: 13 };
    const b = { ...base, lineStart: 12, lineEnd: 15, title: "Overlap" };
    const c = { ...base, lineStart: 40, lineEnd: 42, title: "Far away" };
    const result = deduplicateFindings([a, b, c]);
    expect(result).toHaveLength(2);
    expect(result[0].lineStart).toBe(10);
    expect(result[0].lineEnd).toBe(15);
    expect(result[1].lineStart).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// reflection-agent — pure function tests
// ---------------------------------------------------------------------------

describe("buildReflectionPrompt", () => {
  it("includes MR intent", () => {
    const prompt = buildReflectionPrompt(makeBaseState());
    expect(prompt).toContain("Add Stripe payment integration for subscriptions.");
  });

  it("shows (none) when rawFindings is empty", () => {
    const prompt = buildReflectionPrompt(makeBaseState());
    expect(prompt).toContain("(none)");
  });

  it("serialises rawFindings as JSON", () => {
    const state = {
      ...makeBaseState(),
      rawFindings: [
        {
          file: "src/billing.ts",
          lineStart: 10,
          lineEnd: 15,
          riskLevel: "high" as const,
          title: "Missing check",
          description: "Webhook not validated.",
          evidence: "Line 12.",
        },
      ],
    };
    const prompt = buildReflectionPrompt(state);
    expect(prompt).toContain("Missing check");
    expect(prompt).toContain("src/billing.ts");
  });
});

describe("parseReflectionResponse", () => {
  const validPayload = JSON.stringify({
    verifiedFindings: [],
    summaryVerdict: "APPROVE",
    needsReinvestigation: false,
    reinvestigationReason: "",
  });

  it("parses a valid APPROVE response", () => {
    const result = parseReflectionResponse(makeTextMessage(validPayload));
    expect(result.summaryVerdict).toBe("APPROVE");
    expect(result.verifiedFindings).toEqual([]);
    expect(result.needsReinvestigation).toBe(false);
  });

  it("parses a REQUEST_CHANGES response with findings", () => {
    const payload = JSON.stringify({
      verifiedFindings: [
        {
          file: "src/billing.ts",
          lineStart: 10,
          lineEnd: 15,
          riskLevel: "critical",
          title: "SQL injection",
          description: "Raw query.",
          evidence: "Line 10.",
        },
      ],
      summaryVerdict: "REQUEST_CHANGES",
      needsReinvestigation: false,
    });
    const result = parseReflectionResponse(makeTextMessage(payload));
    expect(result.summaryVerdict).toBe("REQUEST_CHANGES");
    expect(result.verifiedFindings).toHaveLength(1);
    expect(result.verifiedFindings[0].riskLevel).toBe("critical");
  });

  it("accepts needsReinvestigation: true", () => {
    const payload = JSON.stringify({
      verifiedFindings: [],
      summaryVerdict: "NEEDS_DISCUSSION",
      needsReinvestigation: true,
      reinvestigationReason: "Need to check callers",
    });
    const result = parseReflectionResponse(makeTextMessage(payload));
    expect(result.needsReinvestigation).toBe(true);
  });

  it("parses a response wrapped in json fences", () => {
    const fencedPayload = `\`\`\`json\n${validPayload}\n\`\`\``;
    const result = parseReflectionResponse(makeTextMessage(fencedPayload));
    expect(result.summaryVerdict).toBe("APPROVE");
    expect(result.verifiedFindings).toEqual([]);
  });

  it("throws on invalid verdict value", () => {
    const payload = JSON.stringify({
      verifiedFindings: [],
      summaryVerdict: "UNKNOWN",
      needsReinvestigation: false,
    });
    expect(() => parseReflectionResponse(makeTextMessage(payload))).toThrow();
  });

  it("throws when content is empty (no text block)", () => {
    expect(() => parseReflectionResponse(makeTextMessage(""))).toThrow("no text block");
  });

  it("throws on unparseable JSON", () => {
    expect(() => parseReflectionResponse(makeTextMessage("{broken"))).toThrow("unparseable JSON");
  });
});

// ---------------------------------------------------------------------------
// orchestrator — integration tests with mocked agents
// ---------------------------------------------------------------------------

describe("runReview", () => {
  it("calls all three agents in order", async () => {
    mockContextAgent.mockClear();
    mockInvestigatorLoop.mockClear();
    mockReflectionAgent.mockClear();

    const result = await runReview(makeBaseState());

    expect(mockContextAgent).toHaveBeenCalledTimes(1);
    expect(mockInvestigatorLoop).toHaveBeenCalledTimes(1);
    expect(mockReflectionAgent).toHaveBeenCalledTimes(1);
    expect(result.summaryVerdict).toBe("APPROVE");
  });

  it("triggers re-investigation when needsReinvestigation is true", async () => {
    mockContextAgent.mockClear();
    mockInvestigatorLoop.mockClear();
    mockReflectionAgent.mockClear();

    mockReflectionAgent
      .mockImplementationOnce(
        async (s: ReviewState): Promise<ReviewState> => ({
          ...s,
          verifiedFindings: [],
          summaryVerdict: "NEEDS_DISCUSSION",
          needsReinvestigation: true,
        }),
      )
      .mockImplementationOnce(
        async (s: ReviewState): Promise<ReviewState> => ({
          ...s,
          verifiedFindings: [],
          summaryVerdict: "APPROVE",
          needsReinvestigation: false,
        }),
      );

    const result = await runReview(makeBaseState());

    expect(mockInvestigatorLoop).toHaveBeenCalledTimes(2);
    expect(mockReflectionAgent).toHaveBeenCalledTimes(2);
    expect(result.summaryVerdict).toBe("APPROVE");
  });

  it("does not re-investigate more than once", async () => {
    mockContextAgent.mockClear();
    mockInvestigatorLoop.mockClear();
    mockReflectionAgent.mockClear();

    // Both passes request re-investigation — must cap at 1 extra round
    mockReflectionAgent.mockImplementation(
      async (s: ReviewState): Promise<ReviewState> => ({
        ...s,
        verifiedFindings: [],
        summaryVerdict: "NEEDS_DISCUSSION",
        needsReinvestigation: true,
      }),
    );

    await runReview(makeBaseState());

    expect(mockInvestigatorLoop).toHaveBeenCalledTimes(2);
    expect(mockReflectionAgent).toHaveBeenCalledTimes(2);

    // Reset to default for subsequent tests
    mockReflectionAgent.mockImplementation(
      async (s: ReviewState): Promise<ReviewState> => ({
        ...s,
        verifiedFindings: [],
        summaryVerdict: "APPROVE",
        needsReinvestigation: false,
      }),
    );
  });
});

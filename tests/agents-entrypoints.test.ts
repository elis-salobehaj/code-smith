import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentResponse } from "../src/agents/protocol";
import type { ReviewState } from "../src/agents/state";
import { DEFAULT_REPO_CONFIG } from "../src/config/repo-config";

const SANDBOX = join(import.meta.dir, "__temp_agents_entrypoints_sandbox__");

beforeAll(async () => {
  await mkdir(join(SANDBOX, "src"), { recursive: true });
  await writeFile(
    join(SANDBOX, "src/billing.ts"),
    [
      "export function handleWebhook(signature?: string) {",
      "  if (!signature) return false;",
      "  return true;",
      "}",
      "",
    ].join("\n"),
  );
});

afterAll(async () => {
  await rm(SANDBOX, { recursive: true, force: true });
});

function makeBaseState(): ReviewState {
  return {
    mrDetails: {
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
    },
    diffFiles: [
      {
        oldPath: "src/billing.ts",
        newPath: "src/billing.ts",
        newFile: false,
        deletedFile: false,
        renamedFile: false,
        diff: "@@ -1,3 +1,5 @@\n-const x = 1;\n+const x = 2;\n+const y = 3;\n",
      },
    ],
    diffHunks: [],
    repoPath: SANDBOX,
    repoConfig: DEFAULT_REPO_CONFIG,
    triggerContext: { mode: "automatic", source: "merge_request_event" },
    mrIntent: "",
    changeCategories: [],
    riskAreas: [],
    linkedTickets: [],
    discussions: [],
    summaryNotes: [],
    checkpoint: null,
    reviewRange: {
      rangeStart: "abc123",
      rangeEnd: "abc123",
      mode: "full",
    },
    rawFindings: [],
    verifiedFindings: [],
    summaryVerdict: "APPROVE",
    messages: [],
    reinvestigationCount: 0,
    needsReinvestigation: false,
  };
}

function makeAssistantMessage(
  content:
    | { type: "text"; text: string }[]
    | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }[],
): AgentResponse {
  return {
    message: {
      role: "assistant",
      content,
    },
    stopReason: "end_turn",
  };
}

const mockChatCompletion = mock(
  async (): Promise<AgentResponse> =>
    makeAssistantMessage([
      {
        type: "text",
        text: JSON.stringify({
          intent: "placeholder",
          categories: [],
          riskHypotheses: [],
        }),
      },
    ]),
);

mock.module("../src/agents/llm-client", () => ({
  chatCompletion: mockChatCompletion,
}));

const { contextAgent } = await import("../src/agents/context-agent");
const { investigatorLoop } = await import("../src/agents/investigator-agent");
const { reflectionAgent } = await import("../src/agents/reflection-agent");

// ---------------------------------------------------------------------------
// contextAgent
// ---------------------------------------------------------------------------

describe("contextAgent", () => {
  it("hydrates intent, categories, and risk areas from mocked LLM JSON", async () => {
    mockChatCompletion.mockReset();
    mockChatCompletion.mockResolvedValueOnce(
      makeAssistantMessage([
        {
          type: "text",
          text: JSON.stringify({
            intent: "Add Stripe subscription billing support.",
            categories: ["billing", "API"],
            riskHypotheses: ["Check webhook signature validation."],
          }),
        },
      ]),
    );

    const result = await contextAgent(makeBaseState());

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.mrIntent).toBe("Add Stripe subscription billing support.");
    expect(result.changeCategories).toEqual(["billing", "API"]);
    expect(result.riskAreas).toEqual(["Check webhook signature validation."]);
  });
});

// ---------------------------------------------------------------------------
// investigatorLoop
// ---------------------------------------------------------------------------

describe("investigatorLoop", () => {
  it("executes requested tools and parses findings from the final LLM response", async () => {
    mockChatCompletion.mockReset();

    mockChatCompletion
      .mockResolvedValueOnce(
        makeAssistantMessage([
          {
            type: "tool_call",
            id: "tool_1",
            name: "read_file",
            input: { path: "src/billing.ts" },
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeAssistantMessage([
          {
            type: "text",
            text: JSON.stringify([
              {
                file: "src/billing.ts",
                lineStart: 12,
                lineEnd: 12,
                riskLevel: "high",
                title: "Missing webhook signature validation",
                description: "The billing webhook handler accepts unsigned requests.",
                evidence: "No Stripe-Signature header validation was found.",
              },
            ]),
          },
        ]),
      );

    const state = {
      ...makeBaseState(),
      mrIntent: "Add Stripe subscription billing support.",
      changeCategories: ["billing"],
      riskAreas: ["Check webhook signature validation."],
    };

    const result = await investigatorLoop(state);

    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.rawFindings).toHaveLength(1);
    expect(result.rawFindings[0].title).toBe("Missing webhook signature validation");
    expect(result.messages).toHaveLength(4);
  });

  it("stops cleanly when the first response contains no tool requests", async () => {
    mockChatCompletion.mockReset();

    mockChatCompletion.mockResolvedValueOnce(
      makeAssistantMessage([
        {
          type: "text",
          text: "[]",
        },
      ]),
    );

    const result = await investigatorLoop({
      ...makeBaseState(),
      mrIntent: "Refactor billing helpers.",
      changeCategories: ["billing"],
      riskAreas: ["General review."],
    });

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.rawFindings).toEqual([]);
    expect(result.messages).toHaveLength(2);
  });

  it("continues when a tool call fails and passes the error back as a tool result", async () => {
    mockChatCompletion.mockReset();

    mockChatCompletion
      .mockResolvedValueOnce(
        makeAssistantMessage([
          {
            type: "tool_call",
            id: "tool_missing",
            name: "read_file",
            input: { path: "docs/patterns/configuration.md" },
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeAssistantMessage([
          {
            type: "text",
            text: "[]",
          },
        ]),
      );

    const result = await investigatorLoop({
      ...makeBaseState(),
      mrIntent: "Check documentation links.",
      changeCategories: ["documentation"],
      riskAreas: ["Verify referenced files exist."],
    });

    expect(mockChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.rawFindings).toEqual([]);
    expect(result.messages).toHaveLength(4);

    const toolResultMessage = result.messages[2];
    expect(toolResultMessage.role).toBe("user");
    expect(toolResultMessage.content[0]).toMatchObject({
      type: "tool_result",
      toolCallId: "tool_missing",
      isError: true,
    });
  });
});

// ---------------------------------------------------------------------------
// reflectionAgent
// ---------------------------------------------------------------------------

describe("reflectionAgent", () => {
  it("hydrates verified findings, verdict, and reinvestigation flag from mocked LLM JSON", async () => {
    mockChatCompletion.mockReset();
    mockChatCompletion.mockResolvedValueOnce(
      makeAssistantMessage([
        {
          type: "text",
          text: JSON.stringify({
            verifiedFindings: [
              {
                file: "src/billing.ts",
                lineStart: 12,
                lineEnd: 12,
                riskLevel: "high",
                title: "Missing webhook signature validation",
                description: "The billing webhook handler accepts unsigned requests.",
                evidence: "No Stripe-Signature header validation was found.",
              },
            ],
            summaryVerdict: "REQUEST_CHANGES",
            needsReinvestigation: false,
            reinvestigationReason: "",
          }),
        },
      ]),
    );

    const result = await reflectionAgent({
      ...makeBaseState(),
      mrIntent: "Add Stripe subscription billing support.",
      rawFindings: [
        {
          file: "src/billing.ts",
          lineStart: 12,
          lineEnd: 12,
          riskLevel: "high",
          title: "Potential webhook issue",
          description: "Investigate webhook validation.",
          evidence: "Billing webhook path changed.",
        },
      ],
    });

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.verifiedFindings).toHaveLength(1);
    expect(result.summaryVerdict).toBe("REQUEST_CHANGES");
    expect(result.needsReinvestigation).toBe(false);
  });
});

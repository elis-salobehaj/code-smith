import { describe, expect, it } from "bun:test";
import type { AgentMessage, AgentResponse } from "../src/agents/protocol";
import { tryProvidersInOrder } from "../src/agents/provider-fallback";

// ---------------------------------------------------------------------------
// Provider fallback logic tests
//
// These tests exercise tryProvidersInOrder() directly using plain stub
// functions. No mock.module() is required — this avoids module-cache
// isolation issues when the full test suite is run with `bun test`.
// ---------------------------------------------------------------------------

function makeSuccessResponse(text: string): AgentResponse {
  return {
    message: { role: "assistant", content: [{ type: "text", text }] },
    stopReason: "end_turn",
  };
}

const SYSTEM_PROMPT = "You are a code reviewer.";
const MESSAGES: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "Review this diff." }] }];

describe("tryProvidersInOrder — single provider", () => {
  it("calls the provider and returns its response", async () => {
    let calls = 0;
    const stub = async () => {
      calls++;
      return makeSuccessResponse("from bedrock");
    };

    const response = await tryProvidersInOrder([{ name: "bedrock", fn: stub }], SYSTEM_PROMPT, MESSAGES);

    expect(calls).toBe(1);
    expect(response.message.content[0]).toMatchObject({ type: "text", text: "from bedrock" });
  });

  it("passes system prompt, messages, and tools through to the provider", async () => {
    let capturedArgs: unknown[] = [];
    const stub = async (...args: unknown[]) => {
      capturedArgs = args;
      return makeSuccessResponse("ok");
    };

    const tools = [{ name: "read_file", description: "reads", inputSchema: {} }];
    await tryProvidersInOrder(
      [{ name: "bedrock", fn: stub as Parameters<typeof tryProvidersInOrder>[0][0]["fn"] }],
      SYSTEM_PROMPT,
      MESSAGES,
      tools,
    );

    expect(capturedArgs[0]).toBe(SYSTEM_PROMPT);
    expect(capturedArgs[1]).toBe(MESSAGES);
    expect(capturedArgs[2]).toBe(tools);
  });

  it("passes completion options through to the provider", async () => {
    let capturedArgs: unknown[] = [];
    const stub = async (...args: unknown[]) => {
      capturedArgs = args;
      return makeSuccessResponse("ok");
    };

    await tryProvidersInOrder(
      [{ name: "bedrock", fn: stub as Parameters<typeof tryProvidersInOrder>[0][0]["fn"] }],
      SYSTEM_PROMPT,
      MESSAGES,
      undefined,
      { maxOutputTokens: 256 },
    );

    expect(capturedArgs[3]).toEqual({ maxOutputTokens: 256 });
  });
});

describe("tryProvidersInOrder — provider fallback", () => {
  it("falls back to the second provider when the first throws", async () => {
    let bedrockCalls = 0;
    let openaiCalls = 0;

    const bedrockStub = async () => {
      bedrockCalls++;
      throw new Error("Bedrock unavailable");
    };
    const openaiStub = async () => {
      openaiCalls++;
      return makeSuccessResponse("from openai fallback");
    };

    const response = await tryProvidersInOrder(
      [
        { name: "bedrock", fn: bedrockStub },
        { name: "openai", fn: openaiStub },
      ],
      SYSTEM_PROMPT,
      MESSAGES,
    );

    expect(bedrockCalls).toBe(1);
    expect(openaiCalls).toBe(1);
    expect(response.message.content[0]).toMatchObject({ type: "text", text: "from openai fallback" });
  });

  it("re-throws the last error when all providers fail", async () => {
    const providers = [
      {
        name: "bedrock",
        fn: async () => {
          throw new Error("Bedrock down");
        },
      },
      {
        name: "openai",
        fn: async () => {
          throw new Error("OpenAI down");
        },
      },
      {
        name: "google",
        fn: async () => {
          throw new Error("Google down");
        },
      },
    ] as const;

    await expect(tryProvidersInOrder([...providers], SYSTEM_PROMPT, MESSAGES)).rejects.toThrow("Google down");
  });

  it("succeeds with the third provider when the first two fail", async () => {
    const providers = [
      {
        name: "bedrock",
        fn: async () => {
          throw new Error("Bedrock down");
        },
      },
      {
        name: "openai",
        fn: async () => {
          throw new Error("OpenAI down");
        },
      },
      { name: "google", fn: async () => makeSuccessResponse("from google fallback") },
    ] as const;

    const response = await tryProvidersInOrder([...providers], SYSTEM_PROMPT, MESSAGES);
    expect(response.message.content[0]).toMatchObject({ type: "text", text: "from google fallback" });
  });
});

describe("tryProvidersInOrder — empty provider list", () => {
  it("throws a fallback error when no providers are given", async () => {
    await expect(tryProvidersInOrder([], SYSTEM_PROMPT, MESSAGES)).rejects.toThrow("All LLM providers failed");
  });
});

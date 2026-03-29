// ---------------------------------------------------------------------------
// Google Gemini provider adapter (Phase 5.3)
//
// Adapts the CodeSmith internal protocol (AgentMessage[], AgentResponse) to
// and from the Google Generative AI (Gemini) API. Client is lazily initialised
// so importing this module does not fail if GOOGLE_AI_API_KEY is absent.
//
// Message conversion rules:
//  - AgentMessage role="user" text blocks     → Gemini "user" part with text
//  - AgentMessage role="assistant" w/ tool_call blocks → Gemini "model" part
//    with functionCall parts
//  - AgentMessage role="user" tool_result blocks → Gemini "user" part with
//    functionResponse parts (requires tool call name lookup from history)
// ---------------------------------------------------------------------------

import { type Content, GoogleGenerativeAI, type Part, type Tool } from "@google/generative-ai";
import { config } from "../../config";
import type { AgentContentBlock, AgentMessage, AgentResponse, AgentToolDefinition } from "../protocol";

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    if (!config.GOOGLE_AI_API_KEY) {
      throw new Error(
        "GOOGLE_AI_API_KEY is not configured. Add it to your environment or remove 'google' from LLM_PROVIDER_ORDER.",
      );
    }
    _genAI = new GoogleGenerativeAI(config.GOOGLE_AI_API_KEY);
  }
  return _genAI;
}

// ---------------------------------------------------------------------------
// Internal protocol → Gemini format
// ---------------------------------------------------------------------------

function toGeminiTools(tools?: readonly AgentToolDefinition[]): Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const functionDeclarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    // biome-ignore lint/suspicious/noExplicitAny: inputSchema is JSON Schema compatible with FunctionDeclarationSchema
    parameters: t.inputSchema as any,
  }));

  return [{ functionDeclarations }];
}

/**
 * Build a lookup map from toolCallId → toolName so we can populate
 * functionResponse.name, which Gemini requires (unlike OpenAI which uses
 * only the tool_call_id).
 */
function buildToolCallNameMap(messages: AgentMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_call") {
        map.set(block.id, block.name);
      }
    }
  }
  return map;
}

function toGeminiHistory(messages: AgentMessage[]): Content[] {
  const toolCallNames = buildToolCallNameMap(messages);
  const history: Content[] = [];

  for (const msg of messages) {
    const textBlocks = msg.content.filter((b): b is Extract<AgentContentBlock, { type: "text" }> => b.type === "text");
    const toolCallBlks = msg.content.filter(
      (b): b is Extract<AgentContentBlock, { type: "tool_call" }> => b.type === "tool_call",
    );
    const toolResultBlks = msg.content.filter(
      (b): b is Extract<AgentContentBlock, { type: "tool_result" }> => b.type === "tool_result",
    );

    // Gemini uses "user" and "model" roles (not "assistant")
    const geminiRole = msg.role === "assistant" ? "model" : "user";
    const parts: Part[] = [];

    if (textBlocks.length > 0) {
      parts.push({ text: textBlocks.map((b) => b.text).join("\n") });
    }

    for (const tc of toolCallBlks) {
      parts.push({ functionCall: { name: tc.name, args: tc.input } });
    }

    for (const tr of toolResultBlks) {
      const name = toolCallNames.get(tr.toolCallId) ?? tr.toolCallId;
      parts.push({
        functionResponse: {
          name,
          response: { output: tr.output, isError: tr.isError ?? false },
        },
      });
    }

    if (parts.length > 0) {
      history.push({ role: geminiRole, parts });
    }
  }

  return history;
}

// ---------------------------------------------------------------------------
// Gemini format → internal protocol
// ---------------------------------------------------------------------------

function fromGeminiResponse(candidate: { content?: Content; finishReason?: string }): AgentResponse {
  const content: AgentContentBlock[] = [];

  for (const part of candidate.content?.parts ?? []) {
    if ("text" in part && part.text) {
      content.push({ type: "text", text: part.text });
    } else if ("functionCall" in part && part.functionCall) {
      content.push({
        type: "tool_call",
        id: Bun.randomUUIDv7(),
        name: part.functionCall.name,
        input: (part.functionCall.args ?? {}) as Record<string, unknown>,
      });
    }
  }

  const stopReason =
    candidate.finishReason === "STOP"
      ? "end_turn"
      : candidate.finishReason === "MAX_TOKENS"
        ? "max_tokens"
        : candidate.finishReason === "OTHER"
          ? "unknown"
          : "unknown";

  return {
    message: { role: "assistant", content },
    stopReason,
  };
}

// ---------------------------------------------------------------------------
// Public provider function — matches chatCompletion() signature
// ---------------------------------------------------------------------------

export async function googleChatCompletion(
  systemPrompt: string,
  messages: AgentMessage[],
  tools?: readonly AgentToolDefinition[],
): Promise<AgentResponse> {
  const toolCallNames = buildToolCallNameMap(messages);
  const model = getGenAI().getGenerativeModel({
    model: config.GOOGLE_AI_MODEL,
    systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
    tools: toGeminiTools(tools),
  });

  // Split: all messages except the last go into history; the last user
  // message becomes the current turn's prompt.
  const history = toGeminiHistory(messages.slice(0, -1));
  const lastMsg = messages[messages.length - 1];

  const currentParts: Part[] = [];
  for (const block of lastMsg?.content ?? []) {
    if (block.type === "text") {
      currentParts.push({ text: block.text });
    } else if (block.type === "tool_result") {
      const name = toolCallNames.get(block.toolCallId) ?? block.toolCallId;
      currentParts.push({
        functionResponse: {
          name,
          response: { output: block.output, isError: block.isError ?? false },
        },
      });
    }
  }

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(currentParts);
  const candidate = result.response.candidates?.[0];
  if (!candidate) throw new Error("Google Gemini returned no candidates");

  return fromGeminiResponse(candidate);
}

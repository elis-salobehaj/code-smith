// ---------------------------------------------------------------------------
// OpenAI Chat Completions provider adapter (Phase 5.3)
//
// Adapts the CodeSmith internal protocol (AgentMessage[], AgentResponse) to
// and from the OpenAI Chat Completions API. Client is lazily initialised so
// importing this module does not fail if OPENAI_API_KEY is absent — the
// error only surfaces when the provider is actually invoked.
//
// Message conversion rules:
//  - AgentMessage role="user" text blocks     → OpenAI "user" message
//  - AgentMessage role="assistant" w/ tool_call blocks → OpenAI "assistant"
//    message with tool_calls array
//  - AgentMessage role="user" tool_result blocks → one OpenAI "tool" message
//    per result (OpenAI requires each result as a separate message)
// ---------------------------------------------------------------------------

import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources";
import { config } from "../../config";
import type {
  AgentCompletionOptions,
  AgentContentBlock,
  AgentMessage,
  AgentResponse,
  AgentToolDefinition,
} from "../protocol";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    if (!config.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY is not configured. Add it to your environment or remove 'openai' from LLM_PROVIDER_ORDER.",
      );
    }
    _client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Internal protocol → OpenAI format
// ---------------------------------------------------------------------------

function toOpenAITools(tools?: readonly AgentToolDefinition[]): ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

function toOpenAIMessages(systemPrompt: string, messages: AgentMessage[]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    const textBlocks = msg.content.filter((b): b is Extract<AgentContentBlock, { type: "text" }> => b.type === "text");
    const toolCallBlocks = msg.content.filter(
      (b): b is Extract<AgentContentBlock, { type: "tool_call" }> => b.type === "tool_call",
    );
    const toolResultBlocks = msg.content.filter(
      (b): b is Extract<AgentContentBlock, { type: "tool_result" }> => b.type === "tool_result",
    );

    if (msg.role === "user") {
      if (toolResultBlocks.length > 0) {
        // Each tool result becomes a separate "tool" message.
        for (const tr of toolResultBlocks) {
          result.push({ role: "tool", tool_call_id: tr.toolCallId, content: tr.output });
        }
      } else if (textBlocks.length > 0) {
        result.push({ role: "user", content: textBlocks.map((b) => b.text).join("\n") });
      }
    } else if (msg.role === "assistant") {
      const textContent = textBlocks.map((b) => b.text).join("\n") || null;

      if (toolCallBlocks.length > 0) {
        result.push({
          role: "assistant",
          content: textContent,
          tool_calls: toolCallBlocks.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          })),
        });
      } else {
        result.push({ role: "assistant", content: textContent ?? "" });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// OpenAI format → internal protocol
// ---------------------------------------------------------------------------

function fromOpenAIResponse(response: OpenAI.Chat.ChatCompletion): AgentResponse {
  const choice = response.choices[0];
  if (!choice) throw new Error("OpenAI returned no choices");

  const message = choice.message;
  const content: AgentContentBlock[] = [];

  if (message.content) {
    content.push({ type: "text", text: message.content });
  }

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      // Only standard "function" tool calls are supported in the internal protocol.
      if (tc.type !== "function") continue;
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        input = {};
      }
      content.push({
        type: "tool_call",
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  const stopReason =
    choice.finish_reason === "tool_calls"
      ? "tool_call"
      : choice.finish_reason === "stop"
        ? "end_turn"
        : choice.finish_reason === "length"
          ? "max_tokens"
          : "unknown";

  return {
    message: { role: "assistant", content },
    stopReason,
  };
}

// ---------------------------------------------------------------------------
// Public provider function — matches chatCompletion() signature
// ---------------------------------------------------------------------------

export async function openaiChatCompletion(
  systemPrompt: string,
  messages: AgentMessage[],
  tools?: readonly AgentToolDefinition[],
  options?: AgentCompletionOptions,
): Promise<AgentResponse> {
  const response = await getClient().chat.completions.create({
    model: config.OPENAI_MODEL,
    messages: toOpenAIMessages(systemPrompt, messages),
    tools: toOpenAITools(tools),
    tool_choice: tools && tools.length > 0 ? "auto" : undefined,
    max_tokens: options?.maxOutputTokens ?? 8192,
  });

  return fromOpenAIResponse(response);
}

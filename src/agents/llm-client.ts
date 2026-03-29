// ---------------------------------------------------------------------------
// LLM client — multi-provider fallback orchestrator (Phase 5.3)
//
// Provides the single chatCompletion() function consumed by all agents.
// Internally, it resolves the provider order from LLM_PROVIDER_ORDER and
// tries each provider in sequence. If a provider throws, the next one is
// attempted. The last provider's error is re-thrown if all fail.
//
// Provider implementations live in ./providers/:
//   bedrock  → src/agents/providers/bedrock.ts  (AWS Bedrock, primary default)
//   openai   → src/agents/providers/openai.ts   (OpenAI Chat Completions)
//   google   → src/agents/providers/google.ts   (Google Gemini)
//
// The internal protocol boundary is preserved: all provider adapters speak
// AgentMessage[] in / AgentResponse out; no provider SDK types cross this
// module's boundary.
// ---------------------------------------------------------------------------

import { config } from "../config";
import { getLogger } from "../logger";
import type { AgentCompletionOptions, AgentMessage, AgentResponse, AgentToolDefinition } from "./protocol";
import { type ProviderFn, tryProvidersInOrder } from "./provider-fallback";
import { bedrockChatCompletion } from "./providers/bedrock";
import { googleChatCompletion } from "./providers/google";
import { openaiChatCompletion } from "./providers/openai";

const logger = getLogger(["codesmith", "llm"]);

const PROVIDER_REGISTRY: Record<string, ProviderFn> = {
  bedrock: bedrockChatCompletion,
  openai: openaiChatCompletion,
  google: googleChatCompletion,
};

/**
 * Send a chat completion request using the configured provider order.
 *
 * Providers are tried in the order defined by LLM_PROVIDER_ORDER. The first
 * successful response is returned. If a provider throws, the error is logged
 * and the next provider is attempted. If all providers fail, the last error
 * is re-thrown.
 *
 * @param systemPrompt - The system instruction for this agent.
 * @param messages     - The conversation history (user + assistant turns).
 * @param tools        - Optional internal tool definitions to enable tool calls.
 */
export async function chatCompletion(
  systemPrompt: string,
  messages: AgentMessage[],
  tools?: readonly AgentToolDefinition[],
  options?: AgentCompletionOptions,
): Promise<AgentResponse> {
  const providers = config.LLM_PROVIDER_ORDER.flatMap((name) => {
    const fn = PROVIDER_REGISTRY[name];
    if (!fn) {
      logger.warn("Unknown provider in LLM_PROVIDER_ORDER — skipping", { provider: name });
      return [];
    }
    return [{ name, fn }];
  });

  return tryProvidersInOrder(providers, systemPrompt, messages, tools, options);
}

// ---------------------------------------------------------------------------
// provider-fallback.ts
//
// Pure fallback orchestration logic. Kept in a separate module so it can be
// unit-tested without touching the llm-client module (which other tests mock
// via mock.module()). No provider SDK imports — only the internal protocol.
// ---------------------------------------------------------------------------

import { getLogger } from "../logger";
import type { AgentMessage, AgentResponse, AgentToolDefinition } from "./protocol";

const logger = getLogger(["codesmith", "llm"]);

export type ProviderFn = (
  systemPrompt: string,
  messages: AgentMessage[],
  tools?: readonly AgentToolDefinition[],
) => Promise<AgentResponse>;

/**
 * Try a list of provider functions in order, returning the first successful
 * response. On error, logs the failure and advances to the next provider.
 * Re-throws the last error if all providers fail.
 *
 * Exported for direct unit testing — pass provider stubs as arguments instead
 * of using mock.module(), which avoids Bun module-cache isolation issues.
 */
export async function tryProvidersInOrder(
  providers: ReadonlyArray<{ name: string; fn: ProviderFn }>,
  systemPrompt: string,
  messages: AgentMessage[],
  tools?: readonly AgentToolDefinition[],
): Promise<AgentResponse> {
  let lastError: unknown;

  for (const { name: providerName, fn: providerFn } of providers) {
    try {
      const response = await providerFn(systemPrompt, messages, tools);
      if (providers.length > 1 && providers[0].name !== providerName) {
        logger.warn("Using fallback LLM provider", { provider: providerName });
      }
      return response;
    } catch (err) {
      lastError = err;
      logger.warn("LLM provider failed — trying next", {
        provider: providerName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw lastError ?? new Error("All LLM providers failed and no error was captured");
}

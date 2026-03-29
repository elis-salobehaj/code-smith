// ---------------------------------------------------------------------------
// CodeSmith internal agent protocol.
//
// Agents depend on this contract. Provider SDKs adapt to and from it.
// ---------------------------------------------------------------------------

export type AgentRole = "user" | "assistant";

export type AgentStopReason =
  | "end_turn"
  | "tool_call"
  | "max_tokens"
  | "stop_sequence"
  | "pause_turn"
  | "refusal"
  | "unknown";

export interface AgentTextBlock {
  type: "text";
  text: string;
}

export interface AgentToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentToolResultBlock {
  type: "tool_result";
  toolCallId: string;
  output: string;
  isError?: boolean;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type AgentContentBlock = AgentTextBlock | AgentToolCallBlock | AgentToolResultBlock;

export interface AgentMessage {
  role: AgentRole;
  content: AgentContentBlock[];
}

export interface AgentResponse {
  message: AgentMessage;
  stopReason: AgentStopReason;
}

export interface AgentCompletionOptions {
  maxOutputTokens?: number;
}

export function textMessage(role: AgentRole, text: string): AgentMessage {
  return {
    role,
    content: [{ type: "text", text }],
  };
}

export function firstTextBlock(message: AgentMessage): AgentTextBlock | undefined {
  return message.content.find((block): block is AgentTextBlock => block.type === "text");
}

export function toolCallBlocks(message: AgentMessage): AgentToolCallBlock[] {
  return message.content.filter((block): block is AgentToolCallBlock => block.type === "tool_call");
}

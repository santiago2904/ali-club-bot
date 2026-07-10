import type { LlmMessage } from "../sessions/sessionStore";

export const LLM_CLIENT = Symbol("LlmClient");

export interface LlmToolUse {
  id: string;
  name: string;
  input: any;
}

export interface LlmResponse {
  text: string;
  toolUses: LlmToolUse[];
  stopReason: "tool_use" | "end";
}

export interface LlmClient {
  complete(system: string, messages: LlmMessage[], tools: object[]): Promise<LlmResponse>;
}

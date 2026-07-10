import Anthropic from "@anthropic-ai/sdk";
import type { LlmMessage } from "../sessions/sessionStore";
import type { LlmClient, LlmResponse, LlmToolUse } from "./llmClient";

export class AnthropicLlmClient implements LlmClient {
  private client: Anthropic;
  constructor(apiKey: string, private model = "claude-sonnet-5") {
    this.client = new Anthropic({ apiKey });
  }

  async complete(system: string, messages: LlmMessage[], tools: object[]): Promise<LlmResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      tools: tools as any,
      messages: messages as any,
    });

    let text = "";
    const toolUses: LlmToolUse[] = [];
    for (const block of res.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      }
    }
    return { text, toolUses, stopReason: res.stop_reason === "tool_use" ? "tool_use" : "end" };
  }
}

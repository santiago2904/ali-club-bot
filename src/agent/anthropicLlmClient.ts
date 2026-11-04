import Anthropic from "@anthropic-ai/sdk";
import type { LlmMessage } from "../sessions/sessionStore";
import type { LlmClient, LlmResponse, LlmToolUse } from "./llmClient";

/** Copy of the messages with a cache breakpoint on the last block, so each turn reuses the cached prefix. */
export function withCacheBreakpoint(messages: LlmMessage[]): LlmMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  const blocks: any[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...(last.content as any[])];
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

export class AnthropicLlmClient implements LlmClient {
  private client: Anthropic;
  constructor(apiKey: string, private model = "claude-haiku-5-5") {
    // Fail fast in a chat (the SDK default is 10 min); the SDK still retries 429/5xx twice.
    this.client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
  }

  async complete(system: string, messages: LlmMessage[], tools: object[]): Promise<LlmResponse> {
    // Cache order is tools -> system -> messages; the system prompt and tool list are static.
    const cachedTools = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: cachedTools as any,
      // Full history, never trimmed: newer models reject edited history that carries thinking blocks.
      // Conversations reset after 12h idle (PrismaSessionStore), which bounds the size.
      messages: withCacheBreakpoint(messages) as any,
      // Short WhatsApp chat: low effort keeps thinking (and its tokens) to a minimum.
      output_config: { effort: "low" },
    } as any);

    let text = "";
    const toolUses: LlmToolUse[] = [];
    for (const block of (res as any).content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      }
    }
    return {
      text,
      toolUses,
      stopReason: (res as any).stop_reason === "tool_use" ? "tool_use" : "end",
      raw: (res as any).content,
    };
  }
}

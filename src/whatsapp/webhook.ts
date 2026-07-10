export type InboundMessage =
  | { from: string; messageId: string; kind: "text"; text: string }
  | { from: string; messageId: string; kind: "image"; mediaId: string };

export function parseWebhook(body: unknown): InboundMessage[] {
  const result: InboundMessage[] = [];
  const b = body as any;
  const entries = Array.isArray(b?.entry) ? b.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const messages = change?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        if (m.type === "text" && m.text?.body) {
          result.push({ from: m.from, messageId: m.id, kind: "text", text: m.text.body });
        } else if (m.type === "image" && m.image?.id) {
          result.push({ from: m.from, messageId: m.id, kind: "image", mediaId: m.image.id });
        }
      }
    }
  }
  return result;
}

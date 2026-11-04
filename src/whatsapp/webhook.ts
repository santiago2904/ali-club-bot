export type InboundMessage =
  | { from: string; messageId: string; kind: "text"; text: string; profileName?: string }
  | { from: string; messageId: string; kind: "image"; mediaId: string }
  | { from: string; messageId: string; kind: "order"; items: CatalogOrderItem[] }
  | { from: string; messageId: string; kind: "location"; lat: number; lng: number }
  | { from: string; messageId: string; kind: "button"; payload: string }
  | { from: string; messageId: string; kind: "audio"; profileName?: string };

export interface CatalogOrderItem {
  retailerId: string;
  quantity: number;
  priceCop: number;
}

export function parseWebhook(body: unknown): InboundMessage[] {
  const result: InboundMessage[] = [];
  const b = body as any;
  const entries = Array.isArray(b?.entry) ? b.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const messages = change?.value?.messages;
      if (!Array.isArray(messages)) continue;
      // WhatsApp profile names, keyed by wa_id.
      const names = new Map<string, string>();
      for (const c of Array.isArray(change.value.contacts) ? change.value.contacts : []) {
        if (c?.wa_id && typeof c.profile?.name === "string") names.set(c.wa_id, c.profile.name);
      }
      for (const m of messages) {
        if (m.type === "text" && m.text?.body) {
          const profileName = names.get(m.from);
          result.push({ from: m.from, messageId: m.id, kind: "text", text: m.text.body, ...(profileName ? { profileName } : {}) });
        } else if (m.type === "image" && m.image?.id) {
          result.push({ from: m.from, messageId: m.id, kind: "image", mediaId: m.image.id });
        } else if (m.type === "audio") {
          const profileName = names.get(m.from);
          result.push({ from: m.from, messageId: m.id, kind: "audio", ...(profileName ? { profileName } : {}) });
        } else if (m.type === "button" && m.button?.payload) {
          result.push({ from: m.from, messageId: m.id, kind: "button", payload: String(m.button.payload) });
        } else if (m.type === "location" && typeof m.location?.latitude === "number") {
          result.push({ from: m.from, messageId: m.id, kind: "location", lat: m.location.latitude, lng: m.location.longitude });
        } else if (m.type === "order" && Array.isArray(m.order?.product_items)) {
          const items: CatalogOrderItem[] = m.order.product_items.map((i: any) => ({
            retailerId: String(i.product_retailer_id),
            quantity: Number(i.quantity),
            priceCop: Number(i.item_price),
          }));
          result.push({ from: m.from, messageId: m.id, kind: "order", items });
        }
      }
    }
  }
  return result;
}

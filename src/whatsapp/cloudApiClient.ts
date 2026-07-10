import { readFile } from "node:fs/promises";
import type { WhatsAppClient } from "./client";

const GRAPH = "https://graph.facebook.com/v21.0";

export class CloudApiWhatsAppClient implements WhatsAppClient {
  constructor(private token: string, private phoneNumberId: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  }

  async sendText(to: string, text: string): Promise<void> {
    await this.post({ messaging_product: "whatsapp", to, type: "text", text: { body: text } });
  }

  async sendImage(to: string, imagePath: string, caption?: string): Promise<void> {
    const bytes = await readFile(imagePath);
    const mediaId = await this.uploadMedia(bytes, "image/png");
    await this.post({
      messaging_product: "whatsapp", to, type: "image",
      image: { id: mediaId, caption },
    });
  }

  async downloadMedia(mediaId: string): Promise<{ bytes: Buffer; ext: string }> {
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: this.headers() });
    const meta = (await metaRes.json()) as { url: string; mime_type: string };
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    const ext = meta.mime_type.split("/")[1] ?? "jpg";
    return { bytes, ext };
  }

  private async uploadMedia(bytes: Buffer, mime: string): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }));
    const res = await fetch(`${GRAPH}/${this.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  private async post(payload: object): Promise<void> {
    const res = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
  }
}

import { readFile } from "node:fs/promises";
import { WhatsAppClient as KapsoSdkClient } from "@kapso/whatsapp-cloud-api";
import type { WhatsAppClient } from "./client";
import { CATALOG_THUMBNAIL_RETAILER_ID } from "../config/menu";

const KAPSO_BASE_URL = "https://api.kapso.ai/meta/whatsapp";

export class KapsoWhatsAppClient implements WhatsAppClient {
  private sdk: KapsoSdkClient;

  constructor(apiKey: string, private phoneNumberId: string) {
    this.sdk = new KapsoSdkClient({ baseUrl: KAPSO_BASE_URL, kapsoApiKey: apiKey });
  }

  async sendText(to: string, text: string): Promise<void> {
    await this.sdk.messages.sendText({ phoneNumberId: this.phoneNumberId, to, body: text });
  }

  async sendImage(to: string, imagePath: string, caption?: string): Promise<void> {
    const file = await readFile(imagePath);
    const { id } = await this.sdk.media.upload({
      phoneNumberId: this.phoneNumberId,
      type: "image",
      file,
      fileName: imagePath.split("/").pop(),
    });
    await this.sdk.messages.sendImage({ phoneNumberId: this.phoneNumberId, to, image: { id, caption } });
  }

  async sendCatalog(to: string, bodyText: string): Promise<void> {
    await this.sdk.messages.sendInteractiveCatalogMessage({
      phoneNumberId: this.phoneNumberId,
      to,
      bodyText,
      parameters: { thumbnailProductRetailerId: CATALOG_THUMBNAIL_RETAILER_ID },
    });
  }

  async sendLocationRequest(to: string, bodyText: string): Promise<void> {
    // The SDK's sendInteractiveLocationRequest adds parameters Meta rejects; send the raw shape instead.
    await this.sdk.messages.sendInteractiveRaw({
      phoneNumberId: this.phoneNumberId,
      to,
      interactive: { type: "location_request_message", body: { text: bodyText }, action: { name: "send_location" } },
    } as any);
  }

  async sendTemplate(to: string, name: string, bodyParams: string[], buttonPayloads: string[] = []): Promise<void> {
    // Template variables cannot contain newlines/tabs or 4+ consecutive spaces.
    const clean = (v: string) => v.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, " ").trim() || "-";
    await this.sdk.messages.sendRaw({
      phoneNumberId: this.phoneNumberId,
      payload: {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name,
          language: { code: "es" },
          components: [
            { type: "body", parameters: bodyParams.map((text) => ({ type: "text", text: clean(text) })) },
            ...buttonPayloads.map((payload, index) => ({
              type: "button",
              sub_type: "quick_reply",
              index: String(index),
              parameters: [{ type: "payload", payload }],
            })),
          ],
        },
      },
    } as any);
  }

  async getTranscript(messageId: string): Promise<string | null> {
    // Kapso transcribes voice notes asynchronously; give it a few seconds.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const msg: any = await this.sdk.messages.get({ phoneNumberId: this.phoneNumberId, messageId });
        const text = msg?.transcript?.text ?? msg?.kapso?.transcript?.text;
        if (typeof text === "string" && text.trim()) return text.trim();
      } catch {
        // message may not be stored yet
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  }

  async downloadMedia(mediaId: string): Promise<{ bytes: Buffer; ext: string }> {
    const meta = await this.sdk.media.get({ mediaId, phoneNumberId: this.phoneNumberId });
    const data = await this.sdk.media.download({ mediaId, phoneNumberId: this.phoneNumberId, as: "arrayBuffer" });
    const ext = meta.mimeType.split("/")[1] ?? "jpg";
    return { bytes: Buffer.from(data as ArrayBuffer), ext };
  }
}

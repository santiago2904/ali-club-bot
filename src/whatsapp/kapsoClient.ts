import { readFile } from "node:fs/promises";
import { WhatsAppClient as KapsoSdkClient } from "@kapso/whatsapp-cloud-api";
import type { WhatsAppClient } from "./client";

const KAPSO_BASE_URL = "https://app.kapso.ai/api/meta/";

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

  async downloadMedia(mediaId: string): Promise<{ bytes: Buffer; ext: string }> {
    const meta = await this.sdk.media.get({ mediaId, phoneNumberId: this.phoneNumberId });
    const data = await this.sdk.media.download({ mediaId, phoneNumberId: this.phoneNumberId, as: "arrayBuffer" });
    const ext = meta.mimeType.split("/")[1] ?? "jpg";
    return { bytes: Buffer.from(data as ArrayBuffer), ext };
  }
}

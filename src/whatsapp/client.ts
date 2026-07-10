export const WHATSAPP_CLIENT = Symbol("WhatsAppClient");

export interface WhatsAppClient {
  sendText(to: string, text: string): Promise<void>;
  sendImage(to: string, imagePath: string, caption?: string): Promise<void>;
  downloadMedia(mediaId: string): Promise<{ bytes: Buffer; ext: string }>;
}

type SentMessage =
  | { to: string; kind: "text"; text: string }
  | { to: string; kind: "image"; imagePath: string; caption?: string };

export class FakeWhatsAppClient implements WhatsAppClient {
  public sent: SentMessage[] = [];

  async sendText(to: string, text: string): Promise<void> {
    this.sent.push({ to, kind: "text", text });
  }

  async sendImage(to: string, imagePath: string, caption?: string): Promise<void> {
    this.sent.push({ to, kind: "image", imagePath, caption });
  }

  async downloadMedia(_mediaId: string): Promise<{ bytes: Buffer; ext: string }> {
    return { bytes: Buffer.from("fake-image-bytes"), ext: "jpg" };
  }
}

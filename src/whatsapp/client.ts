export const WHATSAPP_CLIENT = Symbol("WhatsAppClient");

export interface WhatsAppClient {
  sendText(to: string, text: string): Promise<void>;
  sendImage(to: string, imagePath: string, caption?: string): Promise<void>;
  downloadMedia(mediaId: string): Promise<{ bytes: Buffer; ext: string }>;
  sendCatalog(to: string, bodyText: string): Promise<void>;
  sendLocationRequest(to: string, bodyText: string): Promise<void>;
  /** Approved template: works outside the 24h window. buttonPayloads map to quick-reply buttons by index. */
  sendTemplate(to: string, name: string, bodyParams: string[], buttonPayloads?: string[]): Promise<void>;
}

type SentMessage =
  | { to: string; kind: "text"; text: string }
  | { to: string; kind: "image"; imagePath: string; caption?: string }
  | { to: string; kind: "catalog"; bodyText: string }
  | { to: string; kind: "location_request"; bodyText: string }
  | { to: string; kind: "template"; name: string; bodyParams: string[]; buttonPayloads?: string[] };

export class FakeWhatsAppClient implements WhatsAppClient {
  public sent: SentMessage[] = [];

  async sendText(to: string, text: string): Promise<void> {
    this.sent.push({ to, kind: "text", text });
  }

  async sendImage(to: string, imagePath: string, caption?: string): Promise<void> {
    this.sent.push({ to, kind: "image", imagePath, caption });
  }

  async sendCatalog(to: string, bodyText: string): Promise<void> {
    this.sent.push({ to, kind: "catalog", bodyText });
  }

  async sendLocationRequest(to: string, bodyText: string): Promise<void> {
    this.sent.push({ to, kind: "location_request", bodyText });
  }

  async sendTemplate(to: string, name: string, bodyParams: string[], buttonPayloads?: string[]): Promise<void> {
    this.sent.push({ to, kind: "template", name, bodyParams, buttonPayloads });
  }

  async downloadMedia(_mediaId: string): Promise<{ bytes: Buffer; ext: string }> {
    return { bytes: Buffer.from("fake-image-bytes"), ext: "jpg" };
  }
}

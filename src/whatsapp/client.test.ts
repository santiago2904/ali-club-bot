import { describe, it, expect } from "vitest";
import { FakeWhatsAppClient } from "./client";

describe("FakeWhatsAppClient", () => {
  it("records sent text and images", async () => {
    const wa = new FakeWhatsAppClient();
    await wa.sendText("57300", "hola");
    await wa.sendImage("57300", "/qr.png", "Escanea");
    expect(wa.sent).toEqual([
      { to: "57300", kind: "text", text: "hola" },
      { to: "57300", kind: "image", imagePath: "/qr.png", caption: "Escanea" },
    ]);
  });

  it("downloadMedia returns bytes and ext", async () => {
    const wa = new FakeWhatsAppClient();
    const { bytes, ext } = await wa.downloadMedia("media-9");
    expect(bytes.length).toBeGreaterThan(0);
    expect(ext).toBe("jpg");
  });
});

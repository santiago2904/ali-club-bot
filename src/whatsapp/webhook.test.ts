import { describe, it, expect } from "vitest";
import { parseWebhook } from "./webhook";

const textPayload = {
  entry: [{ changes: [{ value: { messages: [
    { from: "573001112233", id: "wamid.1", type: "text", text: { body: "hola" } },
  ] } }] }],
};

const imagePayload = {
  entry: [{ changes: [{ value: { messages: [
    { from: "573001112233", id: "wamid.2", type: "image", image: { id: "media-9" } },
  ] } }] }],
};

describe("parseWebhook", () => {
  it("parses a text message", () => {
    const [msg] = parseWebhook(textPayload);
    expect(msg).toEqual({ from: "573001112233", messageId: "wamid.1", kind: "text", text: "hola" });
  });

  it("parses an image message", () => {
    const [msg] = parseWebhook(imagePayload);
    expect(msg).toEqual({ from: "573001112233", messageId: "wamid.2", kind: "image", mediaId: "media-9" });
  });

  it("parses a catalog order message", () => {
    const [msg] = parseWebhook({
      entry: [{ changes: [{ value: { messages: [{
        from: "573001112233", id: "wamid.3", type: "order",
        order: { catalog_id: "c1", product_items: [{ product_retailer_id: "grn0mye6y0", quantity: 2, item_price: 25000, currency: "COP" }] },
      }] } }] }],
    });
    expect(msg).toEqual({
      from: "573001112233", messageId: "wamid.3", kind: "order",
      items: [{ retailerId: "grn0mye6y0", quantity: 2, priceCop: 25000 }],
    });
  });

  it("parses a location message", () => {
    const [msg] = parseWebhook({
      entry: [{ changes: [{ value: { messages: [{
        from: "573001112233", id: "wamid.4", type: "location", location: { latitude: 6.25, longitude: -75.62 },
      }] } }] }],
    });
    expect(msg).toEqual({ from: "573001112233", messageId: "wamid.4", kind: "location", lat: 6.25, lng: -75.62 });
  });

  it("parses a template quick-reply button", () => {
    const [msg] = parseWebhook({
      entry: [{ changes: [{ value: { messages: [{
        from: "573001112233", id: "wamid.5", type: "button", button: { payload: "proof:12", text: "Ver comprobante" },
      }] } }] }],
    });
    expect(msg).toEqual({ from: "573001112233", messageId: "wamid.5", kind: "button", payload: "proof:12" });
  });

  it("attaches the WhatsApp profile name to text messages", () => {
    const [msg] = parseWebhook({
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: "573001112233", profile: { name: "Santiago" } }],
        messages: [{ from: "573001112233", id: "wamid.6", type: "text", text: { body: "hola" } }],
      } }] }],
    });
    expect(msg).toEqual({ from: "573001112233", messageId: "wamid.6", kind: "text", text: "hola", profileName: "Santiago" });
  });

  it("parses a voice note with the profile name", () => {
    const [msg] = parseWebhook({
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: "573001112233", profile: { name: "Ana" } }],
        messages: [{ from: "573001112233", id: "wamid.7", type: "audio", audio: { id: "a1", voice: true } }],
      } }] }],
    });
    expect(msg).toEqual({ from: "573001112233", messageId: "wamid.7", kind: "audio", profileName: "Ana" });
  });

  it("returns empty array for status-only or malformed payloads", () => {
    expect(parseWebhook({ entry: [{ changes: [{ value: { statuses: [] } }] }] })).toEqual([]);
    expect(parseWebhook({})).toEqual([]);
  });
});

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

  it("returns empty array for status-only or malformed payloads", () => {
    expect(parseWebhook({ entry: [{ changes: [{ value: { statuses: [] } }] }] })).toEqual([]);
    expect(parseWebhook({})).toEqual([]);
  });
});

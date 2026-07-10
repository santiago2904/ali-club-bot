import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { WhatsAppSignatureGuard } from "./whatsappSignature.guard";

const SECRET = "test-secret";

function ctx(rawBody: Buffer | undefined, header: string | undefined) {
  const req = {
    rawBody,
    header: (name: string) =>
      name.toLowerCase() === "x-hub-signature-256" ? header : undefined,
  };
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

function sign(body: Buffer): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

describe("WhatsAppSignatureGuard", () => {
  const guard = new WhatsAppSignatureGuard(SECRET);
  const body = Buffer.from(JSON.stringify({ hello: "world" }));

  it("accepts a correctly signed body", () => {
    expect(guard.canActivate(ctx(body, sign(body)))).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(guard.canActivate(ctx(body, "sha256=deadbeef"))).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    expect(guard.canActivate(ctx(body, undefined))).toBe(false);
  });

  it("rejects when the raw body is unavailable", () => {
    expect(guard.canActivate(ctx(undefined, sign(body)))).toBe(false);
  });
});

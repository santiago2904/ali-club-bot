import { describe, it, expect } from "vitest";
import { loadEnv } from "./env";

const full = {
  ANTHROPIC_API_KEY: "k", DATABASE_URL: "d", WHATSAPP_TOKEN: "t",
  WHATSAPP_PHONE_NUMBER_ID: "p", WHATSAPP_VERIFY_TOKEN: "v",
  STAFF_CHAT_ID: "s", PROOF_DIR: "./data/proofs",
  QR_IMAGE_PATH: "./assets/payment-qr.png", PORT: "3000",
};

describe("loadEnv", () => {
  it("parses a full environment", () => {
    const env = loadEnv(full);
    expect(env.PORT).toBe(3000);
    expect(env.ANTHROPIC_API_KEY).toBe("k");
  });

  it("throws when a required var is missing", () => {
    const { ANTHROPIC_API_KEY, ...partial } = full;
    expect(() => loadEnv(partial)).toThrow();
  });
});

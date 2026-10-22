import { describe, it, expect } from "vitest";
import { loadEnv } from "./env";

const full = {
  ANTHROPIC_API_KEY: "k", DATABASE_URL: "d", KAPSO_API_KEY: "t",
  WHATSAPP_PHONE_NUMBER_ID: "p", WHATSAPP_VERIFY_TOKEN: "v",
  STAFF_CHAT_ID: "s", PROOF_DIR: "./data/proofs",
  QR_IMAGE_PATH: "./assets/payment-qr.png", PORT: "3000",
  KAPSO_WEBHOOK_SECRET: "s2", ALLOWED_SENDERS: "573001112233, 573004445566",
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

  it("parses ALLOWED_SENDERS as a trimmed list of numbers", () => {
    expect(loadEnv(full).ALLOWED_SENDERS).toEqual(["573001112233", "573004445566"]);
  });

  it("parses ALLOWED_SENDERS=* as everyone", () => {
    expect(loadEnv({ ...full, ALLOWED_SENDERS: "*" }).ALLOWED_SENDERS).toBe("*");
  });

  it("requires ALLOWED_SENDERS so the bot never answers everyone by accident", () => {
    const { ALLOWED_SENDERS, ...partial } = full;
    expect(() => loadEnv(partial)).toThrow();
    expect(() => loadEnv({ ...full, ALLOWED_SENDERS: " " })).toThrow();
  });
});

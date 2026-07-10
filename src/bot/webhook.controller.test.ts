import { describe, it, expect, vi } from "vitest";
import { WebhookController } from "./webhook.controller";
import type { BotConfig } from "./botConfig";

function make(over: { verifyToken?: string } = {}) {
  const orchestrator = { handleText: vi.fn(async () => []), handleImage: vi.fn(async () => {}) };
  const staff = { handle: vi.fn(async () => false) };
  const config: BotConfig = { staffChatId: "staff-1", qrImagePath: "/qr.png", now: () => new Date() };
  const ctrl = new WebhookController(
    orchestrator as any,
    staff as any,
    config,
    over.verifyToken ?? "verify-me",
  );
  return { ctrl, orchestrator, staff };
}

function res() {
  const r: any = {};
  r.status = vi.fn(() => r);
  r.send = vi.fn(() => r);
  return r;
}

describe("GET /webhook verification", () => {
  it("echoes the challenge when the token matches", () => {
    const { ctrl } = make();
    const r = res();
    ctrl.verify({ "hub.verify_token": "verify-me", "hub.challenge": "12345" }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.send).toHaveBeenCalledWith("12345");
  });

  it("rejects a wrong token", () => {
    const { ctrl } = make();
    const r = res();
    ctrl.verify({ "hub.verify_token": "nope", "hub.challenge": "1" }, r);
    expect(r.status).toHaveBeenCalledWith(403);
  });
});

describe("POST /webhook routing", () => {
  const textBody = (from: string, id: string, body: string) => ({
    entry: [{ changes: [{ value: { messages: [{ from, id, type: "text", text: { body } }] } }] }],
  });

  it("routes a customer text to the orchestrator", async () => {
    const { ctrl, orchestrator } = make();
    await ctrl.receive(textBody("57300", "m1", "hola"));
    expect(orchestrator.handleText).toHaveBeenCalledWith("57300", "hola");
  });

  it("routes a staff-chat message to the staff controller", async () => {
    const { ctrl, staff, orchestrator } = make();
    await ctrl.receive(textBody("staff-1", "m2", "aprobar #3"));
    expect(staff.handle).toHaveBeenCalledWith("aprobar #3", "staff-1");
    expect(orchestrator.handleText).not.toHaveBeenCalled();
  });

  it("dedupes repeated message ids", async () => {
    const { ctrl, orchestrator } = make();
    await ctrl.receive(textBody("57300", "dup", "hola"));
    await ctrl.receive(textBody("57300", "dup", "hola"));
    expect(orchestrator.handleText).toHaveBeenCalledTimes(1);
  });
});

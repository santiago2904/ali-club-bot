import { describe, it, expect } from "vitest";
import { WebhookController } from "./bot/webhook.controller";
import { Orchestrator } from "./agent/orchestrator";
import { StaffController } from "./staff/control";
import { MemorySessionStore } from "./sessions/sessionStore";
import { OrderService } from "./orders/orderService";
import { MemoryOrderRepository } from "./orders/memoryOrderRepository";
import { FakeWhatsAppClient } from "./whatsapp/client";
import { MemoryProofStorage } from "./storage/memoryProofStorage";
import type { BotConfig } from "./bot/botConfig";
import type { LlmClient, LlmResponse } from "./agent/llmClient";

class ScriptedLlm implements LlmClient {
  constructor(private script: LlmResponse[]) {}
  async complete(): Promise<LlmResponse> {
    return this.script.shift() ?? { text: "¿Algo más?", toolUses: [], stopReason: "end" };
  }
}

const textBody = (from: string, id: string, body: string) => ({
  entry: [{ changes: [{ value: { messages: [{ from, id, type: "text", text: { body } }] } }] }],
});
const imageBody = (from: string, id: string, mediaId: string) => ({
  entry: [{ changes: [{ value: { messages: [{ from, id, type: "image", image: { id: mediaId } }] } }] }],
});

describe("E2E happy path (transfer)", () => {
  it("takes an order, receives proof, staff approves, customer notified", async () => {
    const repo = new MemoryOrderRepository();
    const orders = new OrderService(repo);
    const wa = new FakeWhatsAppClient();
    const config: BotConfig = {
      staffChatId: "staff-1", qrImagePath: "/qr.png",
      now: () => new Date(2026, 6, 9, 19, 0),
    };

    const llm = new ScriptedLlm([
      { text: "", toolUses: [{ id: "1", name: "add_item", input: { productId: "wings_12", quantity: 1 } }], stopReason: "tool_use" },
      { text: "", toolUses: [{ id: "2", name: "set_customer_details", input: { name: "Ana", address: "Cra 70", neighborhood: "Laureles" } }], stopReason: "tool_use" },
      { text: "", toolUses: [{ id: "3", name: "confirm_order", input: { paymentMethod: "transfer" } }], stopReason: "tool_use" },
      { text: "", toolUses: [{ id: "4", name: "send_qr", input: {} }], stopReason: "tool_use" },
      { text: "Listo Ana, escanea el QR y envíame el comprobante. 🍗", toolUses: [], stopReason: "end" },
    ]);

    const orchestrator = new Orchestrator(
      llm, new MemorySessionStore(), orders, wa, new MemoryProofStorage(), config,
    );
    const staff = new StaffController(orders, wa);
    const ctrl = new WebhookController(orchestrator, staff, config, "verify-me");

    await ctrl.receive(textBody("57300", "c1", "Quiero 12 alitas para Laureles, soy Ana, Cra 70, pago por transferencia"));
    const created = await repo.findById("1");
    expect(created?.status).toBe("awaiting_payment");
    expect(wa.sent.some((m) => m.kind === "image" && m.imagePath === "/qr.png")).toBe(true);

    await ctrl.receive(imageBody("57300", "c2", "media-9"));
    expect((await repo.findById("1"))?.status).toBe("pending_review");
    expect(wa.sent.some((m) => m.to === "staff-1")).toBe(true);

    await ctrl.receive(textBody("staff-1", "s1", "aprobar #1"));
    expect((await repo.findById("1"))?.status).toBe("approved");
    expect(wa.sent.some((m) => m.to === "57300" && m.kind === "text" && m.text.includes("preparación"))).toBe(true);
  });
});

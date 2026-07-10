import { describe, it, expect } from "vitest";
import { Orchestrator } from "./orchestrator";
import { MemorySessionStore } from "../sessions/sessionStore";
import { OrderService } from "../orders/orderService";
import { MemoryOrderRepository } from "../orders/memoryOrderRepository";
import { FakeWhatsAppClient } from "../whatsapp/client";
import { MemoryProofStorage } from "../storage/memoryProofStorage";
import type { BotConfig } from "../bot/botConfig";
import type { LlmClient, LlmResponse } from "./llmClient";

class ScriptedLlm implements LlmClient {
  constructor(private script: LlmResponse[]) {}
  async complete(): Promise<LlmResponse> {
    const next = this.script.shift();
    if (!next) throw new Error("Script exhausted");
    return next;
  }
}

function build(llm: LlmClient, repo = new MemoryOrderRepository()) {
  const store = new MemorySessionStore();
  const orders = new OrderService(repo);
  const whatsapp = new FakeWhatsAppClient();
  const storage = new MemoryProofStorage();
  const config: BotConfig = {
    staffChatId: "staff-1",
    qrImagePath: "/qr.png",
    now: () => new Date(2026, 6, 9, 19, 0), // open hours
  };
  const orch = new Orchestrator(llm, store, orders, whatsapp, storage, config);
  return { orch, store, orders, whatsapp, storage, repo, config };
}

describe("Orchestrator.handleText", () => {
  it("runs a tool then returns the model's final text", async () => {
    const llm = new ScriptedLlm([
      { text: "", toolUses: [{ id: "t1", name: "get_menu", input: {} }], stopReason: "tool_use" },
      { text: "Estos son nuestros combos 🍗", toolUses: [], stopReason: "end" },
    ]);
    const { orch, whatsapp } = build(llm);
    const out = await orch.handleText("57300", "¿qué tienen?");
    expect(out.join(" ")).toContain("combos");
    expect(whatsapp.sent.some((m) => m.kind === "text" && m.text.includes("combos"))).toBe(true);
  });

  it("outside business hours replies with hours and does not call the LLM", async () => {
    const llm = new ScriptedLlm([]); // must not be used
    const store = new MemorySessionStore();
    const orders = new OrderService(new MemoryOrderRepository());
    const whatsapp = new FakeWhatsAppClient();
    const config: BotConfig = {
      staffChatId: "staff-1", qrImagePath: "/qr.png",
      now: () => new Date(2026, 6, 9, 4, 0), // closed
    };
    const orch = new Orchestrator(llm, store, orders, whatsapp, new MemoryProofStorage(), config);
    const out = await orch.handleText("57300", "hola");
    expect(out.join(" ")).toMatch(/horario|p\.m\./i);
  });
});

describe("Orchestrator.handleImage", () => {
  it("stores proof, attaches to awaiting order, notifies staff", async () => {
    const repo = new MemoryOrderRepository();
    const { orch, store, whatsapp } = build(new ScriptedLlm([]), repo);
    const orders = new OrderService(repo);
    const order = await orders.confirm(
      "57300",
      { items: [{ productId: "wings_12", name: "12 alitas BBQ", quantity: 1, unitPriceCop: 32000 }],
        customerName: "Ana", deliveryAddress: "Cra 70", zone: "laureles", deliveryFeeCop: 5000 },
      "transfer",
    );
    const s = store.get("57300");
    s.lastOrderId = order.id;
    store.save(s);

    await orch.handleImage("57300", "media-9");

    const updated = await repo.findById(order.id);
    expect(updated?.status).toBe("pending_review");
    expect(updated?.proofImagePath).toBeDefined();
    expect(whatsapp.sent.some((m) => m.to === "staff-1")).toBe(true);
  });
});

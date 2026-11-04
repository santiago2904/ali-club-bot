import { describe, it, expect } from "vitest";
import { Orchestrator } from "./orchestrator";
import { MemorySessionStore } from "../sessions/sessionStore";
import { OrderService } from "../orders/orderService";
import { MemoryOrderRepository } from "../orders/memoryOrderRepository";
import { FakeWhatsAppClient } from "../whatsapp/client";
import { MemoryProofStorage } from "../storage/memoryProofStorage";
import type { BotConfig } from "../bot/botConfig";
import type { LlmClient, LlmResponse } from "./llmClient";
import type { ReceiptChecker, ReceiptReading } from "./receiptChecker";

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
    allowedSenders: "*",
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
      allowedSenders: "*",
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

describe("Orchestrator.handleOrder", () => {
  it("adds catalog cart items to the draft and tells the agent they are already added", async () => {
    const seen: any[] = [];
    const llm: LlmClient = {
      async complete(_s, history) {
        seen.push(JSON.stringify(history));
        return { text: "¡Recibido! ¿A qué dirección lo enviamos?", toolUses: [], stopReason: "end" };
      },
    };
    const { orch, store } = build(llm);
    await orch.handleOrder("57300", [
      { retailerId: "grn0mye6y0", quantity: 1, priceCop: 25000 },
      { retailerId: "unknown123", quantity: 2, priceCop: 15000 },
    ]);
    const draft = store.get("57300").draft;
    expect(draft.items).toEqual([
      { productId: "papas_club", name: "Papa's club", quantity: 1, unitPriceCop: 25000 },
      { productId: "unknown123", name: "Producto del catálogo unknown123", quantity: 2, unitPriceCop: 15000 },
    ]);
    expect(seen[0]).toContain("[Pedido desde el catálogo]");
  });

  it("outside business hours does not add items", async () => {
    const { orch, store, config } = build(new ScriptedLlm([]));
    config.now = () => new Date(2026, 6, 9, 4, 0);
    await orch.handleOrder("57300", [{ retailerId: "grn0mye6y0", quantity: 1, priceCop: 25000 }]);
    expect(store.get("57300").draft.items).toEqual([]);
  });
});

describe("Orchestrator.handleLocation", () => {
  const reply = { text: "ok", toolUses: [], stopReason: "end" as const };

  it("quotes delivery by distance and stores it on the draft", async () => {
    const { orch, store } = build(new ScriptedLlm([reply]));
    await orch.handleLocation("57300", 6.2564, -75.621668);
    expect(store.get("57300").draft).toMatchObject({ zone: "0.8 km", deliveryFeeCop: 3000 });
  });

  it("clears the delivery quote when the location is out of coverage", async () => {
    const { orch, store } = build(new ScriptedLlm([reply]));
    Object.assign(store.get("57300").draft, { zone: "0.8 km", deliveryFeeCop: 3000 });
    await orch.handleLocation("57300", 6.2087, -75.5674);
    expect(store.get("57300").draft).toMatchObject({ zone: undefined, deliveryFeeCop: 0 });
  });
});

describe("Orchestrator tool failures", () => {
  it("keeps the conversation going when a tool throws", async () => {
    const llm = new ScriptedLlm([
      { text: "", toolUses: [{ id: "t1", name: "request_location", input: {} }], stopReason: "tool_use" },
      { text: "Escríbeme tu dirección y el local te confirma el domicilio.", toolUses: [], stopReason: "end" },
    ]);
    const { orch, whatsapp } = build(llm);
    whatsapp.sendLocationRequest = async () => { throw new Error("meta 400"); };
    const out = await orch.handleText("57300", "Loma del indio");
    expect(out.join(" ")).toContain("dirección");
  });
});

describe("Orchestrator.handleImage with receipt reading", () => {
  async function setup(reading: ReceiptReading) {
    const repo = new MemoryOrderRepository();
    const store = new MemorySessionStore();
    const orders = new OrderService(repo);
    const whatsapp = new FakeWhatsAppClient();
    const checker: ReceiptChecker = { read: async () => reading };
    const config: BotConfig = { allowedSenders: "*", staffChatId: "staff-1", qrImagePath: "/qr.png", now: () => new Date(2026, 6, 9, 19, 0) };
    const orch = new Orchestrator(new ScriptedLlm([]), store, orders, whatsapp, new MemoryProofStorage(), config, checker);
    const order = await orders.confirm(
      "57300",
      { items: [{ productId: "alitas_16", name: "Combo 16 alitas", quantity: 1, unitPriceCop: 34000 }],
        customerName: "Ana", deliveryAddress: "Cra 110 # 39B-39", zone: "0.8 km", deliveryFeeCop: 3000,
        deliveryLat: 6.25, deliveryLng: -75.62 },
      "transfer",
    );
    const s = store.get("57300");
    s.lastOrderId = order.id;
    store.save(s);
    await orch.handleImage("57300", "media-1");
    return { repo, whatsapp, order };
  }

  it("asks for a real receipt and does not bother staff when the image is not one", async () => {
    const { repo, whatsapp, order } = await setup({ isPaymentReceipt: false, amountCop: null, bank: null, date: null, reference: null });
    expect((await repo.findById(order.id))?.status).toBe("awaiting_payment");
    expect(whatsapp.sent.some((m) => m.to === "staff-1")).toBe(false);
    expect(whatsapp.sent.some((m) => m.kind === "text" && m.text.includes("no parece un comprobante"))).toBe(true);
  });

  it("stores the reading and sends the staff template with map link and buttons", async () => {
    const { repo, whatsapp, order } = await setup({ isPaymentReceipt: true, amountCop: 30000, bank: "Nequi", date: null, reference: null });
    const updated = await repo.findById(order.id);
    expect(updated?.status).toBe("pending_review");
    expect(updated?.proofCheck).toContain("⚠️");
    const tpl = whatsapp.sent.find((m) => m.kind === "template");
    expect(tpl && tpl.kind === "template" && tpl.name).toBe("pedido_pendiente_revision");
    if (tpl?.kind === "template") {
      expect(tpl.to).toBe("staff-1");
      expect(tpl.bodyParams.join(" ")).toContain("https://maps.google.com/?q=6.25,-75.62");
      expect(tpl.buttonPayloads).toEqual([`proof:${order.id}`, `approve:${order.id}`]);
    }
  });
});

describe("Orchestrator.handleLocation stores coordinates", () => {
  it("keeps lat/lng on the draft for the courier map link", async () => {
    const { orch, store } = build(new ScriptedLlm([{ text: "ok", toolUses: [], stopReason: "end" }]));
    await orch.handleLocation("57300", 6.2564, -75.621668);
    expect(store.get("57300").draft).toMatchObject({ deliveryLat: 6.2564, deliveryLng: -75.621668 });
  });
});


describe("Orchestrator staff alert fallback", () => {
  it("falls back to plain text when the template cannot be sent", async () => {
    const repo = new MemoryOrderRepository();
    const { orch, whatsapp } = build(new ScriptedLlm([]), repo);
    whatsapp.sendTemplate = async () => { throw new Error("template not approved"); };
    const order = await new OrderService(repo).confirm(
      "57300",
      { items: [{ productId: "alitas_8", name: "Combo 8 alitas", quantity: 1, unitPriceCop: 18000 }],
        customerName: "Ana", deliveryAddress: "Cra 1", zone: "1 km", deliveryFeeCop: 4000 },
      "cash",
    );
    await orch.notifyStaffPendingReview(order);
    expect(whatsapp.sent.some((m) => m.to === "staff-1" && m.kind === "text" && m.text.includes(`aprobar #${order.id}`))).toBe(true);
  });
});

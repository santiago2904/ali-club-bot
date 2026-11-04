import { describe, it, expect } from "vitest";
import { Orchestrator, greetingName } from "./orchestrator";
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
    staffChatIds: ["staff-1"],
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
      staffChatIds: ["staff-1"], qrImagePath: "/qr.png",
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
  it("adds catalog cart items to the draft and asks for the location without calling the LLM", async () => {
    const { orch, store, whatsapp } = build(new ScriptedLlm([])); // must not be used
    await orch.handleOrder("57300", [
      { retailerId: "grn0mye6y0", quantity: 1, priceCop: 25000 },
      { retailerId: "unknown123", quantity: 2, priceCop: 15000 },
    ]);
    const session = store.get("57300");
    expect(session.draft.items).toEqual([
      { productId: "papas_club", name: "Papa's club", quantity: 1, unitPriceCop: 25000 },
      { productId: "unknown123", name: "Producto del catálogo unknown123", quantity: 2, unitPriceCop: 15000 },
    ]);
    expect(whatsapp.sent.some((m) => m.kind === "text" && m.text.includes("Subtotal: $55.000"))).toBe(true);
    expect(whatsapp.sent.some((m) => m.kind === "location_request")).toBe(true);
    expect(JSON.stringify(session.history)).toContain("[Pedido desde el catálogo]");
  });

  it("outside business hours does not add items", async () => {
    const { orch, store, config } = build(new ScriptedLlm([]));
    config.now = () => new Date(2026, 6, 9, 4, 0);
    await orch.handleOrder("57300", [{ retailerId: "grn0mye6y0", quantity: 1, priceCop: 25000 }]);
    expect(store.get("57300").draft.items).toEqual([]);
  });
});

describe("Orchestrator.handleLocation", () => {

  it("quotes delivery by distance and stores it on the draft", async () => {
    const { orch, store } = build(new ScriptedLlm([]));
    await orch.handleLocation("57300", 6.2564, -75.621668);
    expect(store.get("57300").draft).toMatchObject({ zone: "0.8 km", deliveryFeeCop: 4000 });
  });

  it("clears the delivery quote when the location is out of coverage", async () => {
    const { orch, store } = build(new ScriptedLlm([]));
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
    const config: BotConfig = { allowedSenders: "*", staffChatIds: ["staff-1"], qrImagePath: "/qr.png", now: () => new Date(2026, 6, 9, 19, 0) };
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
    const { orch, store } = build(new ScriptedLlm([]));
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

describe("Orchestrator closed-hours contacts", () => {
  it("remembers who wrote while closed, and forgets them once they write while open", async () => {
    const { MemoryClosedHoursContacts } = await import("../sessions/closedHoursContacts");
    const contacts = new MemoryClosedHoursContacts();
    let now = new Date(2026, 6, 9, 4, 0);
    const config: BotConfig = { allowedSenders: "*", staffChatIds: ["staff-1"], qrImagePath: "/qr.png", now: () => now };
    const orch = new Orchestrator(
      new ScriptedLlm([{ text: "¡Hola!", toolUses: [], stopReason: "end" }]),
      new MemorySessionStore(), new OrderService(new MemoryOrderRepository()), new FakeWhatsAppClient(),
      new MemoryProofStorage(), config, undefined, contacts,
    );
    const out = await orch.handleText("57300", "hola");
    expect(out.join(" ")).toContain("Te escribimos apenas abramos");

    now = new Date(2026, 6, 9, 19, 0);
    await orch.handleText("57300", "ya abrieron?");
    expect(await contacts.drain()).toEqual([]);
  });
});

describe("Orchestrator token savers", () => {
  it("ends the turn after a location request and drops the model's redundant text", async () => {
    const llm = new ScriptedLlm([
      { text: "¿Me compartes tu ubicación?", toolUses: [{ id: "t1", name: "request_location", input: {} }], stopReason: "tool_use" },
      // no second response scripted: a second LLM call would throw "Script exhausted"
    ]);
    const { orch, whatsapp, store } = build(llm);
    store.get("57300").history.push({ role: "user", content: "hola" }, { role: "assistant", content: "¡Hola!" });
    await orch.handleText("57300", "melo");
    expect(whatsapp.sent.map((m) => m.kind)).toEqual(["location_request"]);
  });

  it("replies to a shared location without the LLM", async () => {
    const { orch, whatsapp } = build(new ScriptedLlm([]));
    await orch.handleLocation("57300", 6.2087, -75.5674); // far away
    expect(whatsapp.sent.some((m) => m.kind === "text" && m.text.includes("no alcanzamos"))).toBe(true);
  });
});

describe("Orchestrator when Claude is down", () => {
  const down: LlmClient = { complete: async () => { throw new Error("overloaded"); } };

  it("apologizes to the customer and alerts staff, once per outage window", async () => {
    const { orch, whatsapp } = build(down);
    await orch.handleText("57300", "hola");
    await orch.handleText("57300", "hola??");
    const apologies = whatsapp.sent.filter((m) => m.to === "57300" && m.kind === "text" && m.text.includes("problema técnico"));
    expect(apologies).toHaveLength(1);
    expect(whatsapp.sent.some((m) => m.to === "staff-1" && m.kind === "text" && m.text.includes("+57300"))).toBe(true);
  });

  it("still quotes delivery and takes catalog carts, which don't need Claude", async () => {
    const { orch, whatsapp } = build(down);
    await orch.handleOrder("57300", [{ retailerId: "grn0mye6y0", quantity: 1, priceCop: 25000 }]);
    await orch.handleLocation("57300", 6.2564, -75.621668);
    expect(whatsapp.sent.some((m) => m.kind === "text" && m.text.includes("Domicilio: $4.000"))).toBe(true);
  });
});

describe("Orchestrator notifies every staff member", () => {
  it("sends the review alert to all staff, even if one of them fails", async () => {
    const repo = new MemoryOrderRepository();
    const whatsapp = new FakeWhatsAppClient();
    const original = whatsapp.sendTemplate.bind(whatsapp);
    whatsapp.sendTemplate = async (to, ...rest) => {
      if (to === "staff-a") throw new Error("boom");
      return original(to, ...rest);
    };
    whatsapp.sendText = async (to) => { if (to === "staff-a") throw new Error("outside 24h"); };
    const config: BotConfig = { allowedSenders: "*", staffChatIds: ["staff-a", "staff-b"], qrImagePath: "/qr.png", now: () => new Date(2026, 6, 9, 19, 0) };
    const orch = new Orchestrator(new ScriptedLlm([]), new MemorySessionStore(), new OrderService(repo), whatsapp, new MemoryProofStorage(), config);
    const order = await new OrderService(repo).confirm(
      "57300",
      { items: [{ productId: "alitas_8", name: "Combo 8 alitas", quantity: 1, unitPriceCop: 18000 }],
        customerName: "Ana", deliveryAddress: "Cra 1", zone: "1 km", deliveryFeeCop: 4000 },
      "cash",
    );
    await orch.notifyStaffPendingReview(order);
    expect(whatsapp.sent.some((m) => m.to === "staff-b" && m.kind === "template")).toBe(true);
  });
});

describe("Orchestrator greeting", () => {
  it("greets by WhatsApp first name on the first message, before the model replies", async () => {
    const llm = new ScriptedLlm([{ text: "", toolUses: [{ id: "t1", name: "request_location", input: {} }], stopReason: "tool_use" }]);
    const { orch, whatsapp, store } = build(llm);
    await orch.handleText("57300", "me mandan unas alitas de 42k", "santiago palacio");
    expect(whatsapp.sent[0]).toMatchObject({ kind: "text", text: "¡Hola Santiago! 👋 Bienvenido/a a Ali~club 🍔🍗" });
    expect(whatsapp.sent[1].kind).toBe("location_request");
    expect(JSON.stringify(store.get("57300").history[0])).toContain("no vuelvas a saludar");
  });

  it("does not greet again later in the conversation", async () => {
    const { orch, whatsapp } = build(new ScriptedLlm([
      { text: "¿Qué te provoca?", toolUses: [], stopReason: "end" },
      { text: "Listo", toolUses: [], stopReason: "end" },
    ]));
    await orch.handleText("57300", "hola", "Ana");
    await orch.handleText("57300", "16 alitas", "Ana");
    expect(whatsapp.sent.filter((m) => m.kind === "text" && m.text.startsWith("¡Hola"))).toHaveLength(1);
  });

  it("uses the name only when it looks like a real name", () => {
    expect(greetingName("Santiago Palacio")).toBe("Santiago");
    expect(greetingName("🌸✨")).toBeNull();
    expect(greetingName(".")).toBeNull();
    expect(greetingName(undefined)).toBeNull();
    expect(greetingName("JOSÉ")).toBe("José");
  });
});

describe("Orchestrator voice notes", () => {
  it("handles the transcript like a typed message, flagged as a voice note", async () => {
    const seen: string[] = [];
    const llm: LlmClient = {
      async complete(_s, history) {
        seen.push(JSON.stringify(history));
        return { text: "Listo, ¿algo más?", toolUses: [], stopReason: "end" };
      },
    };
    const { orch, whatsapp } = build(llm);
    whatsapp.transcripts.set("wamid.v1", "quiero 16 alitas y una gaseosa");
    await orch.handleAudio("57300", "wamid.v1", "Ana");
    expect(seen[0]).toContain("[Nota de voz transcrita] quiero 16 alitas y una gaseosa");
    expect(whatsapp.sent.some((m) => m.kind === "text" && m.text === "Listo, ¿algo más?")).toBe(true);
  });

  it("asks the customer to type when there is no transcript, without calling the LLM", async () => {
    const { orch, whatsapp } = build(new ScriptedLlm([]));
    await orch.handleAudio("57300", "wamid.v2");
    expect(whatsapp.sent).toEqual([{ to: "57300", kind: "text", text: "No pude escuchar bien tu audio 🙉 ¿Me lo escribes, porfa?" }]);
  });
});


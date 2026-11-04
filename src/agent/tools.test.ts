import { describe, it, expect } from "vitest";
import { runTool, TOOL_DEFS, type ToolContext } from "./tools";
import { MemorySessionStore } from "../sessions/sessionStore";
import { OrderService } from "../orders/orderService";
import { MemoryOrderRepository } from "../orders/memoryOrderRepository";
import { FakeWhatsAppClient } from "../whatsapp/client";

function ctx(): ToolContext {
  const store = new MemorySessionStore();
  return {
    session: store.get("57300"),
    store,
    orders: new OrderService(new MemoryOrderRepository()),
    whatsapp: new FakeWhatsAppClient(),
    staffChatId: "staff-1",
    qrImagePath: "/qr.png",
  };
}

describe("runTool", () => {
  it("get_menu lists products", async () => {
    const { result } = await runTool("get_menu", {}, ctx());
    expect(result).toContain("alitas");
  });

  it("request_location sends a location request", async () => {
    const c = ctx();
    await runTool("request_location", {}, c);
    expect((c.whatsapp as FakeWhatsAppClient).sent.some((m) => m.kind === "location_request")).toBe(true);
  });

  it("confirm_order requires a delivery location quote", async () => {
    const c = ctx();
    await runTool("add_item", { productId: "alitas_8", quantity: 1 }, c);
    await runTool("set_customer_details", { name: "Ana", address: "Cra 70", neighborhood: "Laureles" }, c);
    const { result } = await runTool("confirm_order", { paymentMethod: "cash" }, c);
    expect(result).toContain("ubicación");
  });

  it("add_item adds a known product to the draft", async () => {
    const c = ctx();
    await runTool("add_item", { productId: "alitas_8", quantity: 2 }, c);
    expect(c.session.draft.items[0]).toMatchObject({ productId: "alitas_8", quantity: 2 });
  });

  it("add_item rejects an unknown product", async () => {
    const { result } = await runTool("add_item", { productId: "nope", quantity: 1 }, ctx());
    expect(result.toLowerCase()).toContain("no existe");
  });

  it("confirm_order requires a complete draft", async () => {
    const { result } = await runTool("confirm_order", { paymentMethod: "cash" }, ctx());
    expect(result.toLowerCase()).toContain("falta");
  });

  it("confirm_order (transfer) creates an order and reports its id", async () => {
    const c = ctx();
    await runTool("add_item", { productId: "alitas_8", quantity: 1 }, c);
    await runTool("set_customer_details", { name: "Ana", address: "Cra 70", neighborhood: "Laureles" }, c);
    Object.assign(c.session.draft, { zone: "0.8 km", deliveryFeeCop: 3000 });
    const { result, confirmedOrderId } = await runTool("confirm_order", { paymentMethod: "transfer" }, c);
    expect(confirmedOrderId).toBeDefined();
    expect(result.toLowerCase()).toContain("transferencia");
  });

  it("send_qr sends the QR image to the customer", async () => {
    const c = ctx();
    await runTool("send_qr", {}, c);
    const wa = c.whatsapp as FakeWhatsAppClient;
    expect(wa.sent.some((m) => m.kind === "image" && m.imagePath === "/qr.png")).toBe(true);
  });

  it("confirm_order resets the draft so a second order does not reuse confirmed items", async () => {
    const c = ctx();
    await runTool("add_item", { productId: "alitas_8", quantity: 1 }, c);
    await runTool("set_customer_details", { name: "Ana", address: "Cra 70", neighborhood: "Laureles" }, c);
    Object.assign(c.session.draft, { zone: "0.8 km", deliveryFeeCop: 3000 });
    await runTool("confirm_order", { paymentMethod: "cash" }, c);
    expect(c.session.draft.items).toEqual([]);
  });

  it("send_catalog sends the interactive catalog", async () => {
    const c = ctx();
    await runTool("send_catalog", {}, c);
    const wa = c.whatsapp as FakeWhatsAppClient;
    expect(wa.sent.some((m) => m.kind === "catalog" && m.to === "57300")).toBe(true);
  });

  it("send_catalog falls back to the text menu when sending fails", async () => {
    const c = ctx();
    (c.whatsapp as FakeWhatsAppClient).sendCatalog = async () => { throw new Error("no catalog"); };
    const { result } = await runTool("send_catalog", {}, c);
    expect(result).toContain("get_menu");
  });

  it("has no approval-capable tool (only human staff can approve)", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    for (const forbidden of ["approve_order", "confirm_payment", "approve", "mark_paid"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

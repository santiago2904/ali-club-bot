import { describe, it, expect } from "vitest";
import { runTool, type ToolContext } from "./tools";
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

  it("validate_zone reports coverage", async () => {
    const { result } = await runTool("validate_zone", { neighborhood: "Laureles" }, ctx());
    expect(result.toLowerCase()).toContain("cubre");
  });

  it("add_item adds a known product to the draft", async () => {
    const c = ctx();
    await runTool("add_item", { productId: "wings_12", quantity: 2 }, c);
    expect(c.session.draft.items[0]).toMatchObject({ productId: "wings_12", quantity: 2 });
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
    await runTool("add_item", { productId: "wings_12", quantity: 1 }, c);
    await runTool("set_customer_details", { name: "Ana", address: "Cra 70", neighborhood: "Laureles" }, c);
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
});

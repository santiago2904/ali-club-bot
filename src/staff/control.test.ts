import { describe, it, expect } from "vitest";
import { parseStaffCommand, StaffController } from "./control";
import { OrderService } from "../orders/orderService";
import { MemoryOrderRepository } from "../orders/memoryOrderRepository";
import { FakeWhatsAppClient } from "../whatsapp/client";
import type { OrderDraft } from "../domain/order";

function draft(): OrderDraft {
  return {
    items: [{ productId: "wings_12", name: "12 alitas BBQ", quantity: 1, unitPriceCop: 32000 }],
    customerName: "Ana", deliveryAddress: "Cra 70", zone: "laureles", deliveryFeeCop: 5000,
  };
}

describe("parseStaffCommand", () => {
  it("parses approve", () => {
    expect(parseStaffCommand("aprobar #12")).toEqual({ action: "approve", orderId: "12" });
  });
  it("parses reject with reason", () => {
    expect(parseStaffCommand("rechazar #7 sin cobertura")).toEqual({ action: "reject", orderId: "7", reason: "sin cobertura" });
  });
  it("returns null for non-commands", () => {
    expect(parseStaffCommand("hola equipo")).toBeNull();
  });
});

describe("StaffController.handle", () => {
  it("approves an order and notifies the customer", async () => {
    const repo = new MemoryOrderRepository();
    const orders = new OrderService(repo);
    const wa = new FakeWhatsAppClient();
    const order = await orders.confirm("57300", draft(), "cash"); // pending_review
    const ctrl = new StaffController(orders, wa);

    const handled = await ctrl.handle(`aprobar #${order.id}`, "cocina");
    expect(handled).toBe(true);
    expect((await repo.findById(order.id))?.status).toBe("approved");
    expect(wa.sent.some((m) => m.to === "57300" && m.kind === "text")).toBe(true);
  });

  it("rejects and includes the reason to the customer", async () => {
    const repo = new MemoryOrderRepository();
    const orders = new OrderService(repo);
    const wa = new FakeWhatsAppClient();
    const order = await orders.confirm("57300", draft(), "cash");
    const ctrl = new StaffController(orders, wa);

    await ctrl.handle(`rechazar #${order.id} pago no recibido`, "cocina");
    expect((await repo.findById(order.id))?.status).toBe("rejected");
    const msg = wa.sent.find((m) => m.to === "57300");
    expect(msg && msg.kind === "text" && msg.text.includes("pago no recibido")).toBe(true);
  });

  it("returns false for a non-command", async () => {
    const ctrl = new StaffController(new OrderService(new MemoryOrderRepository()), new FakeWhatsAppClient());
    expect(await ctrl.handle("buenas", "cocina")).toBe(false);
  });
});

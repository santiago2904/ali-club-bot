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
    expect(parseStaffCommand("aprobar #12")).toEqual({ action: "approve", orderNumber: 12 });
  });
  it("parses reject with reason", () => {
    expect(parseStaffCommand("rechazar #7 sin cobertura")).toEqual({ action: "reject", orderNumber: 7, reason: "sin cobertura" });
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

    const handled = await ctrl.handle(`aprobar #${order.number}`, "cocina");
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

    await ctrl.handle(`rechazar #${order.number} pago no recibido`, "cocina");
    expect((await repo.findById(order.id))?.status).toBe("rejected");
    const msg = wa.sent.find((m) => m.to === "57300");
    expect(msg && msg.kind === "text" && msg.text.includes("pago no recibido")).toBe(true);
  });

  it("returns false for a non-command", async () => {
    const ctrl = new StaffController(new OrderService(new MemoryOrderRepository()), new FakeWhatsAppClient());
    expect(await ctrl.handle("buenas", "cocina")).toBe(false);
  });
});

describe("StaffController buttons and courier", () => {
  const config = { staffChatIds: ["staff-1"], courierChatId: "courier-1", qrImagePath: "/qr.png", allowedSenders: "*" as const, now: () => new Date() };

  it("'approve' button approves, notifies the courier with the template, and confirms to staff", async () => {
    const repo = new MemoryOrderRepository();
    const orders = new OrderService(repo);
    const wa = new FakeWhatsAppClient();
    const order = await orders.confirm("57300", { ...draft(), deliveryLat: 6.25, deliveryLng: -75.62 }, "cash");
    await new StaffController(orders, wa, config).handleButton(`approve:${order.number}`, "staff-1");

    expect((await repo.findById(order.id))?.status).toBe("approved");
    const tpl = wa.sent.find((m) => m.kind === "template");
    expect(tpl?.to).toBe("courier-1");
    if (tpl?.kind === "template") {
      expect(tpl.name).toBe("domicilio_asignado");
      expect(tpl.bodyParams).toContain("Cobrar $37.000 en efectivo");
    }
    expect(wa.sent.some((m) => m.to === "staff-1" && m.kind === "text" && m.text.includes("domiciliario"))).toBe(true);
  });

  it("tells the courier not to charge transfer orders", async () => {
    const repo = new MemoryOrderRepository();
    const orders = new OrderService(repo);
    const wa = new FakeWhatsAppClient();
    const order = await orders.confirm("57300", draft(), "transfer");
    await orders.attachProof(order.id, "/p.jpg");
    await new StaffController(orders, wa, config).handle(`aprobar #${order.number}`, "staff-1");
    const tpl = wa.sent.find((m) => m.kind === "template");
    expect(tpl?.kind === "template" && tpl.bodyParams.some((p) => p.includes("No cobrar"))).toBe(true);
  });

  it("'proof' button sends the stored proof image to staff", async () => {
    const repo = new MemoryOrderRepository();
    const orders = new OrderService(repo);
    const wa = new FakeWhatsAppClient();
    const order = await orders.confirm("57300", draft(), "transfer");
    await orders.attachProof(order.id, "/proofs/1.jpg", "Comprobante leído");
    await new StaffController(orders, wa, config).handleButton(`proof:${order.number}`, "staff-1");
    expect(wa.sent.some((m) => m.to === "staff-1" && m.kind === "image" && m.imagePath === "/proofs/1.jpg")).toBe(true);
  });

  it("does not notify a courier when none is configured", async () => {
    const orders = new OrderService(new MemoryOrderRepository());
    const wa = new FakeWhatsAppClient();
    const order = await orders.confirm("57300", draft(), "cash");
    await new StaffController(orders, wa).handle(`aprobar #${order.number}`, "staff-1");
    expect(wa.sent.some((m) => m.kind === "template")).toBe(false);
  });
});


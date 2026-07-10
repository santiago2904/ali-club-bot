import { describe, it, expect } from "vitest";
import { OrderService } from "./orderService";
import { MemoryOrderRepository } from "./memoryOrderRepository";
import type { OrderDraft } from "../domain/order";

function draft(): OrderDraft {
  return {
    items: [{ productId: "wings_12", name: "12 alitas BBQ", quantity: 1, unitPriceCop: 32000 }],
    customerName: "Ana",
    deliveryAddress: "Cra 70 # 1-2",
    zone: "laureles",
    deliveryFeeCop: 5000,
  };
}

describe("OrderService.confirm", () => {
  it("transfer order starts as awaiting_payment with computed totals", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "transfer");
    expect(order.status).toBe("awaiting_payment");
    expect(order.subtotalCop).toBe(32000);
    expect(order.totalCop).toBe(37000);
  });

  it("cash order goes straight to pending_review", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "cash");
    expect(order.status).toBe("pending_review");
  });

  it("rejects an incomplete draft", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const bad = { ...draft(), items: [] };
    await expect(svc.confirm("57300", bad, "cash")).rejects.toThrow();
  });
});

describe("OrderService.attachProof and review", () => {
  it("attaching proof moves awaiting_payment -> pending_review", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "transfer");
    const withProof = await svc.attachProof(order.id, "/proofs/x.jpg");
    expect(withProof.status).toBe("pending_review");
    expect(withProof.proofImagePath).toBe("/proofs/x.jpg");
  });

  it("review approves from pending_review", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "cash");
    const approved = await svc.review(order.id, "approved", "cocina");
    expect(approved.status).toBe("approved");
  });

  it("review refuses an illegal transition", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "transfer"); // awaiting_payment
    await expect(svc.review(order.id, "approved", "cocina")).rejects.toThrow();
  });
});

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

  it("reviewing the same order concurrently rejects the loser with 'already reviewed'", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "cash");
    // Both calls read the order (still pending_review) before either writes,
    // simulating two staff members racing to review the same order.
    const results = await Promise.allSettled([
      svc.review(order.id, "approved", "cocina"),
      svc.review(order.id, "approved", "cocina"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/already reviewed/);
  });
});

describe("OrderService.bestSellers", () => {
  const draft = (name: string, quantity: number) => ({
    items: [{ productId: name, name, quantity, unitPriceCop: 1000 }],
    customerName: "Ana", deliveryAddress: "Cra 1", zone: "1 km", deliveryFeeCop: 0,
  });

  async function approvedOrders(svc: OrderService, list: [string, number][]) {
    for (const [name, qty] of list) {
      const o = await svc.confirm("57300", draft(name, qty), "cash");
      await svc.review(o.id, "approved", "staff");
    }
  }

  it("returns nothing until there are enough approved orders", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    await approvedOrders(svc, [["A", 5]]);
    expect(await svc.bestSellers()).toEqual([]);
  });

  it("ranks products by units across approved orders", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    await approvedOrders(svc, [["A", 1], ["B", 3], ["C", 2], ["B", 1], ["A", 1], ["A", 1], ["C", 1], ["D", 1], ["A", 1], ["B", 1]]);
    expect(await svc.bestSellers()).toEqual([
      { name: "B", units: 5 }, { name: "A", units: 4 }, { name: "C", units: 3 },
    ]);
  });

  it("ignores orders that were not approved", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    for (let i = 0; i < 12; i++) await svc.confirm("57300", draft("X", 1), "cash");
    expect(await svc.bestSellers()).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { MemoryOrderRepository } from "./memoryOrderRepository";
import type { CreateOrderInput } from "./orderRepository";

const input: CreateOrderInput = {
  customerPhone: "573001112233",
  customerName: "Ana",
  items: [{ productId: "wings_12", name: "12 alitas BBQ", quantity: 1, unitPriceCop: 32000 }],
  deliveryAddress: "Cra 70 # 1-2",
  zone: "laureles",
  deliveryFeeCop: 5000,
  subtotalCop: 32000,
  totalCop: 37000,
  paymentMethod: "transfer",
  status: "awaiting_payment",
};

describe("MemoryOrderRepository", () => {
  it("creates and finds an order", async () => {
    const repo = new MemoryOrderRepository();
    const created = await repo.create(input);
    expect(created.id).toBe("1");
    expect(created.status).toBe("awaiting_payment");
    expect((await repo.findById("1"))?.customerName).toBe("Ana");
  });

  it("attaches proof and moves to pending_review, then transitions to approved", async () => {
    const repo = new MemoryOrderRepository();
    await repo.create(input);
    const withProof = await repo.attachProof("1", "/proofs/1.jpg");
    expect(withProof.status).toBe("pending_review");
    expect(withProof.proofImagePath).toBe("/proofs/1.jpg");

    const reviewed = await repo.transition("1", "pending_review", "approved", "cocina");
    expect(reviewed?.status).toBe("approved");
    expect(reviewed?.reviewedBy).toBe("cocina");
    expect(reviewed?.reviewedAt).toBeInstanceOf(Date);
  });

  it("transition returns null when the order is no longer in expectedFrom", async () => {
    const repo = new MemoryOrderRepository();
    await repo.create(input); // status: awaiting_payment (per fixture)
    const result = await repo.transition("1", "building", "approved", "x");
    expect(result).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  calcSubtotalCop, calcTotalCop, emptyDraft, canTransition, OrderItem,
} from "./order";

const items: OrderItem[] = [
  { productId: "wings_12", name: "12 alitas BBQ", quantity: 2, unitPriceCop: 32000 },
  { productId: "soda", name: "Gaseosa personal", quantity: 1, unitPriceCop: 4000 },
];

describe("order pricing", () => {
  it("sums quantity * unitPrice", () => {
    expect(calcSubtotalCop(items)).toBe(68000);
  });
  it("adds delivery fee to total", () => {
    expect(calcTotalCop(68000, 5000)).toBe(73000);
  });
  it("empty draft has no items and zero fee", () => {
    const d = emptyDraft();
    expect(d.items).toEqual([]);
    expect(d.deliveryFeeCop).toBe(0);
  });
});

describe("state machine", () => {
  it("allows building -> awaiting_payment and building -> pending_review", () => {
    expect(canTransition("building", "awaiting_payment")).toBe(true);
    expect(canTransition("building", "pending_review")).toBe(true);
  });
  it("allows awaiting_payment -> pending_review", () => {
    expect(canTransition("awaiting_payment", "pending_review")).toBe(true);
  });
  it("allows pending_review -> approved and -> rejected", () => {
    expect(canTransition("pending_review", "approved")).toBe(true);
    expect(canTransition("pending_review", "rejected")).toBe(true);
  });
  it("rejects illegal jumps", () => {
    expect(canTransition("building", "approved")).toBe(false);
    expect(canTransition("approved", "rejected")).toBe(false);
  });
});

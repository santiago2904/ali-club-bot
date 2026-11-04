import { Inject, Injectable } from "@nestjs/common";
import {
  calcSubtotalCop, calcTotalCop, canTransition,
  type Order, type OrderDraft, type PaymentMethod,
} from "../domain/order";
import { ORDER_REPOSITORY, type CreateOrderInput, type OrderRepository } from "./orderRepository";

@Injectable()
export class OrderService {
  constructor(@Inject(ORDER_REPOSITORY) private repo: OrderRepository) {}

  async confirm(phone: string, draft: OrderDraft, paymentMethod: PaymentMethod): Promise<Order> {
    if (draft.items.length === 0) throw new Error("Draft has no items");
    if (!draft.customerName) throw new Error("Missing customer name");
    if (!draft.deliveryAddress) throw new Error("Missing delivery address");
    if (!draft.zone) throw new Error("Missing zone");

    const subtotalCop = calcSubtotalCop(draft.items);
    const totalCop = calcTotalCop(subtotalCop, draft.deliveryFeeCop);
    const status = paymentMethod === "transfer" ? "awaiting_payment" : "pending_review";

    const input: CreateOrderInput = {
      customerPhone: phone,
      customerName: draft.customerName,
      items: draft.items,
      deliveryAddress: draft.deliveryAddress,
      zone: draft.zone,
      deliveryLat: draft.deliveryLat ?? null,
      deliveryLng: draft.deliveryLng ?? null,
      deliveryFeeCop: draft.deliveryFeeCop,
      subtotalCop,
      totalCop,
      paymentMethod,
      status,
    };
    return this.repo.create(input);
  }

  async attachProof(orderId: string, proofImagePath: string, proofCheck: string | null = null): Promise<Order> {
    const order = await this.mustGet(orderId);
    if (!canTransition(order.status, "pending_review")) {
      throw new Error(`Cannot attach proof from ${order.status}`);
    }
    return this.repo.attachProof(orderId, proofImagePath, proofCheck);
  }

  async review(
    orderId: string,
    decision: "approved" | "rejected",
    reviewedBy: string,
  ): Promise<Order> {
    const order = await this.mustGet(orderId);
    if (!canTransition(order.status, decision)) {
      throw new Error(`Cannot ${decision} from ${order.status}`);
    }
    const updated = await this.repo.transition(orderId, order.status, decision, reviewedBy);
    if (!updated) throw new Error(`Order ${orderId} already reviewed`);
    return updated;
  }

  /**
   * Top products by units in approved orders over the last `days`.
   * Returns [] until there are at least `minOrders` approved orders, so the bot never claims popularity without data.
   */
  async bestSellers(days = 30, limit = 3, minOrders = 10): Promise<{ name: string; units: number }[]> {
    const orders = await this.repo.findApprovedSince(new Date(Date.now() - days * 86_400_000));
    if (orders.length < minOrders) return [];
    const units = new Map<string, number>();
    for (const o of orders) for (const i of o.items) units.set(i.name, (units.get(i.name) ?? 0) + i.quantity);
    return [...units.entries()]
      .map(([name, u]) => ({ name, units: u }))
      .sort((a, b) => b.units - a.units)
      .slice(0, limit);
  }

  getByNumber(number: number): Promise<Order | null> {
    return this.repo.findByNumber(number);
  }

  getById(orderId: string): Promise<Order | null> {
    return this.repo.findById(orderId);
  }

  private async mustGet(orderId: string): Promise<Order> {
    const order = await this.repo.findById(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    return order;
  }
}

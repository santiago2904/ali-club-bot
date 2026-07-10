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
      deliveryFeeCop: draft.deliveryFeeCop,
      subtotalCop,
      totalCop,
      paymentMethod,
      status,
    };
    return this.repo.create(input);
  }

  async attachProof(orderId: string, proofImagePath: string): Promise<Order> {
    const order = await this.mustGet(orderId);
    if (!canTransition(order.status, "pending_review")) {
      throw new Error(`Cannot attach proof from ${order.status}`);
    }
    return this.repo.attachProof(orderId, proofImagePath);
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

  getById(orderId: string): Promise<Order | null> {
    return this.repo.findById(orderId);
  }

  private async mustGet(orderId: string): Promise<Order> {
    const order = await this.repo.findById(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    return order;
  }
}

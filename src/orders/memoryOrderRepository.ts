import type { Order, OrderStatus } from "../domain/order";
import type { CreateOrderInput, OrderRepository } from "./orderRepository";

export class MemoryOrderRepository implements OrderRepository {
  private orders = new Map<string, Order>();
  private seq = 0;

  async create(input: CreateOrderInput): Promise<Order> {
    const id = String(++this.seq);
    const order: Order = {
      id,
      ...input,
      proofImagePath: null,
      proofCheck: null,
      createdAt: new Date(),
      reviewedBy: null,
      reviewedAt: null,
    };
    this.orders.set(id, order);
    return order;
  }

  async findById(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null;
  }

  async attachProof(id: string, proofImagePath: string, proofCheck: string | null): Promise<Order> {
    const order = this.mustGet(id);
    const updated: Order = { ...order, proofImagePath, proofCheck, status: "pending_review" };
    this.orders.set(id, updated);
    return updated;
  }

  async transition(
    id: string,
    expectedFrom: OrderStatus,
    to: OrderStatus,
    reviewedBy: string,
  ): Promise<Order | null> {
    const order = this.mustGet(id);
    if (order.status !== expectedFrom) return null;
    const updated: Order = { ...order, status: to, reviewedBy, reviewedAt: new Date() };
    this.orders.set(id, updated);
    return updated;
  }

  async findApprovedSince(since: Date): Promise<Order[]> {
    return [...this.orders.values()].filter((o) => o.status === "approved" && o.createdAt >= since);
  }

  private mustGet(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new Error(`Order ${id} not found`);
    return order;
  }
}

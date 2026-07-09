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

  async updateStatus(id: string, status: OrderStatus, reviewedBy?: string): Promise<Order> {
    const order = this.mustGet(id);
    const updated: Order = {
      ...order,
      status,
      reviewedBy: reviewedBy ?? order.reviewedBy,
      reviewedAt: new Date(),
    };
    this.orders.set(id, updated);
    return updated;
  }

  async setProof(id: string, proofImagePath: string): Promise<Order> {
    const order = this.mustGet(id);
    const updated: Order = { ...order, proofImagePath };
    this.orders.set(id, updated);
    return updated;
  }

  private mustGet(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new Error(`Order ${id} not found`);
    return order;
  }
}

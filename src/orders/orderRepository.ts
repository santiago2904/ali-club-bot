import type { Order, OrderItem, OrderStatus, PaymentMethod } from "../domain/order";

export const ORDER_REPOSITORY = Symbol("OrderRepository");

export interface CreateOrderInput {
  customerPhone: string;
  customerName: string;
  items: OrderItem[];
  deliveryAddress: string;
  zone: string;
  deliveryFeeCop: number;
  subtotalCop: number;
  totalCop: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
}

export interface OrderRepository {
  create(input: CreateOrderInput): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  /** Atomically stores the proof AND moves the order to pending_review. */
  attachProof(id: string, proofImagePath: string): Promise<Order>;
  /**
   * Conditionally transitions the order from `expectedFrom` to `to` in a single
   * atomic write. Returns the updated order, or null if the order was no longer
   * in `expectedFrom` (i.e. someone else already transitioned it — race lost).
   */
  transition(id: string, expectedFrom: OrderStatus, to: OrderStatus, reviewedBy: string): Promise<Order | null>;
}

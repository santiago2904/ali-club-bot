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
  updateStatus(id: string, status: OrderStatus, reviewedBy?: string): Promise<Order>;
  setProof(id: string, proofImagePath: string): Promise<Order>;
}

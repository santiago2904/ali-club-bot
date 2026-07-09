import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { Order, OrderItem, OrderStatus, PaymentMethod } from "../domain/order";
import type { CreateOrderInput, OrderRepository } from "./orderRepository";

type Row = {
  id: string; customerPhone: string; customerName: string; items: unknown;
  deliveryAddress: string; zone: string; deliveryFeeCop: number; subtotalCop: number;
  totalCop: number; paymentMethod: string; proofImagePath: string | null; status: string;
  createdAt: Date; reviewedBy: string | null; reviewedAt: Date | null;
};

function toOrder(row: Row): Order {
  return {
    id: row.id,
    customerPhone: row.customerPhone,
    customerName: row.customerName,
    items: row.items as OrderItem[],
    deliveryAddress: row.deliveryAddress,
    zone: row.zone,
    deliveryFeeCop: row.deliveryFeeCop,
    subtotalCop: row.subtotalCop,
    totalCop: row.totalCop,
    paymentMethod: row.paymentMethod as PaymentMethod,
    proofImagePath: row.proofImagePath,
    status: row.status as OrderStatus,
    createdAt: row.createdAt,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
  };
}

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateOrderInput): Promise<Order> {
    const row = await this.prisma.order.create({
      data: { ...input, items: input.items as unknown as object },
    });
    return toOrder(row as Row);
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id } });
    return row ? toOrder(row as Row) : null;
  }

  async updateStatus(id: string, status: OrderStatus, reviewedBy?: string): Promise<Order> {
    const row = await this.prisma.order.update({
      where: { id },
      data: { status, reviewedBy: reviewedBy ?? undefined, reviewedAt: new Date() },
    });
    return toOrder(row as Row);
  }

  async setProof(id: string, proofImagePath: string): Promise<Order> {
    const row = await this.prisma.order.update({ where: { id }, data: { proofImagePath } });
    return toOrder(row as Row);
  }
}

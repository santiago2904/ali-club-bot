import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { Order, OrderItem, OrderStatus, PaymentMethod } from "../domain/order";
import type { CreateOrderInput, OrderRepository } from "./orderRepository";

type Row = {
  id: string; customerPhone: string; customerName: string; items: unknown;
  deliveryAddress: string; zone: string; deliveryLat: number | null; deliveryLng: number | null; deliveryFeeCop: number; subtotalCop: number;
  totalCop: number; paymentMethod: string; proofImagePath: string | null; proofCheck: string | null; status: string;
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
    deliveryLat: row.deliveryLat,
    deliveryLng: row.deliveryLng,
    deliveryFeeCop: row.deliveryFeeCop,
    subtotalCop: row.subtotalCop,
    totalCop: row.totalCop,
    paymentMethod: row.paymentMethod as PaymentMethod,
    proofImagePath: row.proofImagePath,
    proofCheck: row.proofCheck,
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

  async attachProof(id: string, proofImagePath: string, proofCheck: string | null): Promise<Order> {
    const row = await this.prisma.order.update({
      where: { id },
      data: { proofImagePath, proofCheck, status: "pending_review" },
    });
    return toOrder(row as Row);
  }

  async findApprovedSince(since: Date): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({ where: { status: "approved", createdAt: { gte: since } } });
    return rows.map((r) => toOrder(r as Row));
  }

  async transition(
    id: string,
    expectedFrom: OrderStatus,
    to: OrderStatus,
    reviewedBy: string,
  ): Promise<Order | null> {
    const res = await this.prisma.order.updateMany({
      where: { id, status: expectedFrom },
      data: { status: to, reviewedBy, reviewedAt: new Date() },
    });
    if (res.count === 0) return null;
    return this.findById(id);
  }
}

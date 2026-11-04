export type PaymentMethod = "transfer" | "cash";

export type OrderStatus =
  | "building"
  | "awaiting_payment"
  | "pending_review"
  | "approved"
  | "rejected";

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
}

export interface OrderDraft {
  items: OrderItem[];
  customerName?: string;
  deliveryAddress?: string;
  zone?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  deliveryFeeCop: number;
}

export interface Order {
  id: string;
  /** Short, human-friendly sequential number shown to customers and staff (#12). */
  number: number;
  customerPhone: string;
  customerName: string;
  items: OrderItem[];
  deliveryAddress: string;
  zone: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryFeeCop: number;
  subtotalCop: number;
  totalCop: number;
  paymentMethod: PaymentMethod;
  proofImagePath: string | null;
  /** Automatic reading of the payment proof (never an approval). */
  proofCheck: string | null;
  status: OrderStatus;
  createdAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}

export function calcSubtotalCop(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unitPriceCop, 0);
}

export function calcTotalCop(subtotalCop: number, deliveryFeeCop: number): number {
  return subtotalCop + deliveryFeeCop;
}

export function mapsLink(order: Pick<Order, "deliveryLat" | "deliveryLng">): string {
  return order.deliveryLat != null && order.deliveryLng != null
    ? `https://maps.google.com/?q=${order.deliveryLat},${order.deliveryLng}`
    : "Sin ubicación compartida";
}

export function emptyDraft(): OrderDraft {
  return { items: [], deliveryFeeCop: 0 };
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  building: ["awaiting_payment", "pending_review"],
  awaiting_payment: ["pending_review"],
  pending_review: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

import { Inject, Injectable, Optional } from "@nestjs/common";
import { BOT_CONFIG, type BotConfig } from "../bot/botConfig";
import { mapsLink, type Order } from "../domain/order";
import { OrderService } from "../orders/orderService";
import { WHATSAPP_CLIENT, type WhatsAppClient } from "../whatsapp/client";

export interface StaffCommand {
  action: "approve" | "reject";
  orderId: string;
  reason?: string;
}

const RE = /^(aprobar|rechazar)\s+#?(\w+)\s*(.*)$/i;

export function parseStaffCommand(text: string): StaffCommand | null {
  const m = RE.exec(text.trim());
  if (!m) return null;
  const action = m[1].toLowerCase() === "aprobar" ? "approve" : "reject";
  const orderId = m[2];
  const reason = m[3].trim();
  return { action, orderId, ...(reason ? { reason } : {}) };
}

@Injectable()
export class StaffController {
  constructor(
    private orders: OrderService,
    @Inject(WHATSAPP_CLIENT) private whatsapp: WhatsAppClient,
    @Optional() @Inject(BOT_CONFIG) private config?: BotConfig,
  ) {}

  /** Quick-reply buttons from the staff template: "proof:<id>" or "approve:<id>". */
  async handleButton(payload: string, reviewedBy: string): Promise<void> {
    const [action, orderId] = payload.split(":");
    if (action === "approve") {
      await this.handle(`aprobar #${orderId}`, reviewedBy);
      return;
    }
    if (action === "proof") {
      const order = await this.orders.getById(orderId);
      if (order?.proofImagePath) {
        await this.whatsapp.sendImage(reviewedBy, order.proofImagePath, `Comprobante #${order.id}. ${order.proofCheck ?? ""}`.trim());
      } else {
        await this.whatsapp.sendText(reviewedBy, `El pedido #${orderId} no tiene comprobante (pago en efectivo o aún no lo envían).`);
      }
    }
  }

  async handle(text: string, reviewedBy: string): Promise<boolean> {
    const cmd = parseStaffCommand(text);
    if (!cmd) return false;

    if (cmd.action === "approve") {
      const order = await this.orders.review(cmd.orderId, "approved", reviewedBy);
      await this.whatsapp.sendText(
        order.customerPhone,
        `¡Buenas noticias! Tu pedido #${order.id} fue confirmado y ya está en preparación. 🍗 Pronto llega a ${order.deliveryAddress}.`,
      );
      const courierNotified = await this.notifyCourier(order);
      await this.whatsapp.sendText(
        reviewedBy,
        `✅ Pedido #${order.id} aprobado.${courierNotified ? " Ya se le avisó al domiciliario." : ""}`,
      );
    } else {
      const order = await this.orders.review(cmd.orderId, "rejected", reviewedBy);
      const reason = cmd.reason ? ` Motivo: ${cmd.reason}.` : "";
      await this.whatsapp.sendText(
        order.customerPhone,
        `Lo sentimos, tu pedido #${order.id} no pudo confirmarse.${reason} Si crees que es un error, escríbenos.`,
      );
    }
    return true;
  }

  private async notifyCourier(order: Order): Promise<boolean> {
    const courier = this.config?.courierChatId;
    if (!courier) return false;
    const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;
    const charge =
      order.paymentMethod === "cash"
        ? `Cobrar ${cop(order.totalCop)} en efectivo`
        : `Ya pagó por transferencia (${cop(order.totalCop)}). No cobrar`;
    try {
      await this.whatsapp.sendTemplate(courier, "domicilio_asignado", [
        order.id,
        order.customerName,
        `+${order.customerPhone}`,
        order.deliveryAddress,
        mapsLink(order),
        order.items.map((i) => `${i.quantity} x ${i.name}`).join(", "),
        charge,
      ]);
      return true;
    } catch (err) {
      console.error(`Courier notification failed for #${order.id}:`, (err as Error).message);
      return false;
    }
  }
}

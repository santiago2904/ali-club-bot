import { Inject, Injectable, Optional } from "@nestjs/common";
import { BOT_CONFIG, type BotConfig } from "../bot/botConfig";
import { mapsLink, type Order } from "../domain/order";
import { OrderService } from "../orders/orderService";
import { WHATSAPP_CLIENT, type WhatsAppClient } from "../whatsapp/client";

export interface StaffCommand {
  action: "approve" | "reject";
  orderNumber: number;
  reason?: string;
}

const RE = /^(aprobar|rechazar)\s+#?(\d+)\s*(.*)$/i;

export function parseStaffCommand(text: string): StaffCommand | null {
  const m = RE.exec(text.trim());
  if (!m) return null;
  const action = m[1].toLowerCase() === "aprobar" ? "approve" : "reject";
  const reason = m[3].trim();
  return { action, orderNumber: Number(m[2]), ...(reason ? { reason } : {}) };
}

@Injectable()
export class StaffController {
  constructor(
    private orders: OrderService,
    @Inject(WHATSAPP_CLIENT) private whatsapp: WhatsAppClient,
    @Optional() @Inject(BOT_CONFIG) private config?: BotConfig,
  ) {}

  /** Quick-reply buttons from the staff template: "proof:<number>" or "approve:<number>". */
  async handleButton(payload: string, reviewedBy: string): Promise<void> {
    const [action, num] = payload.split(":");
    if (action === "approve") {
      await this.handle(`aprobar #${num}`, reviewedBy);
      return;
    }
    if (action === "proof") {
      const order = await this.orders.getByNumber(Number(num));
      if (order?.proofImagePath) {
        await this.whatsapp.sendImage(reviewedBy, order.proofImagePath, `Comprobante #${order.number}. ${order.proofCheck ?? ""}`.trim());
      } else {
        await this.whatsapp.sendText(reviewedBy, `El pedido #${num} no tiene comprobante (pago en efectivo o aún no lo envían).`);
      }
    }
  }

  async handle(text: string, reviewedBy: string): Promise<boolean> {
    const cmd = parseStaffCommand(text);
    if (!cmd) return false;

    const found = await this.orders.getByNumber(cmd.orderNumber);
    if (!found) {
      await this.whatsapp.sendText(reviewedBy, `No encontré el pedido #${cmd.orderNumber}.`);
      return true;
    }

    let order: Order;
    try {
      order = await this.orders.review(found.id, cmd.action === "approve" ? "approved" : "rejected", reviewedBy);
    } catch {
      // e.g. already reviewed, or still waiting for the payment proof.
      await this.whatsapp.sendText(reviewedBy, `El pedido #${found.number} no se puede ${cmd.action === "approve" ? "aprobar" : "rechazar"} (estado: ${found.status}).`);
      return true;
    }

    if (cmd.action === "approve") {
      await this.whatsapp.sendText(
        order.customerPhone,
        `¡Buenas noticias! Tu pedido fue confirmado y ya está en preparación. 🍗 Pronto llega a ${order.deliveryAddress}.`,
      );
      const courierNotified = await this.notifyCourier(order);
      await this.whatsapp.sendText(
        reviewedBy,
        `✅ Pedido #${order.number} aprobado.${courierNotified ? " Ya se le avisó al domiciliario." : ""}`,
      );
    } else {
      const reason = cmd.reason ? ` Motivo: ${cmd.reason}.` : "";
      await this.whatsapp.sendText(
        order.customerPhone,
        `Lo sentimos, tu pedido no pudo confirmarse.${reason} Si crees que es un error, escríbenos.`,
      );
      await this.whatsapp.sendText(reviewedBy, `❌ Pedido #${order.number} rechazado. Ya se le avisó al cliente.`);
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
        String(order.number),
        order.customerName,
        `+${order.customerPhone}`,
        order.deliveryAddress,
        mapsLink(order),
        order.items.map((i) => `${i.quantity} x ${i.name}`).join(", "),
        charge,
      ]);
      return true;
    } catch (err) {
      console.error(`Courier notification failed for #${order.number}:`, (err as Error).message);
      return false;
    }
  }
}

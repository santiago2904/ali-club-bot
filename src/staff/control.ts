import { Inject, Injectable } from "@nestjs/common";
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
  ) {}

  async handle(text: string, reviewedBy: string): Promise<boolean> {
    const cmd = parseStaffCommand(text);
    if (!cmd) return false;

    if (cmd.action === "approve") {
      const order = await this.orders.review(cmd.orderId, "approved", reviewedBy);
      await this.whatsapp.sendText(
        order.customerPhone,
        `¡Buenas noticias! Tu pedido #${order.id} fue confirmado y ya está en preparación. 🍗 Pronto llega a ${order.deliveryAddress}.`,
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
}

import { Inject, Injectable } from "@nestjs/common";
import { LLM_CLIENT, type LlmClient } from "./llmClient";
import { SESSION_STORE, type SessionStore } from "../sessions/sessionStore";
import { OrderService } from "../orders/orderService";
import { WHATSAPP_CLIENT, type WhatsAppClient } from "../whatsapp/client";
import { PROOF_STORAGE, type ProofStorage } from "../storage/proofStorage";
import { BOT_CONFIG, type BotConfig } from "../bot/botConfig";
import type { Order } from "../domain/order";
import { buildSystemPrompt } from "./prompt";
import { TOOL_DEFS, runTool, type ToolContext } from "./tools";
import { isOpen, hoursText } from "../config/businessHours";

const MAX_TOOL_ROUNDS = 8;

@Injectable()
export class Orchestrator {
  constructor(
    @Inject(LLM_CLIENT) private llm: LlmClient,
    @Inject(SESSION_STORE) private store: SessionStore,
    private orders: OrderService,
    @Inject(WHATSAPP_CLIENT) private whatsapp: WhatsAppClient,
    @Inject(PROOF_STORAGE) private storage: ProofStorage,
    @Inject(BOT_CONFIG) private config: BotConfig,
  ) {}

  async handleText(phone: string, text: string): Promise<string[]> {
    if (!isOpen(this.config.now())) {
      const msg = `¡Hola! En este momento estamos cerrados. ${hoursText()} Escríbenos en ese horario y con gusto te tomamos el pedido. 🍗`;
      await this.whatsapp.sendText(phone, msg);
      return [msg];
    }

    const session = this.store.get(phone);
    session.history.push({ role: "user", content: [{ type: "text", text }] });

    const system = buildSystemPrompt();
    const replies: string[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.llm.complete(system, session.history, TOOL_DEFS);

      const assistantContent: any[] = [];
      if (res.text) assistantContent.push({ type: "text", text: res.text });
      for (const tu of res.toolUses) {
        assistantContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      }
      session.history.push({ role: "assistant", content: assistantContent });

      if (res.text.trim()) {
        await this.whatsapp.sendText(phone, res.text);
        replies.push(res.text);
      }

      if (res.stopReason !== "tool_use" || res.toolUses.length === 0) break;

      const ctx: ToolContext = {
        session,
        store: this.store,
        orders: this.orders,
        whatsapp: this.whatsapp,
        staffChatId: this.config.staffChatId,
        qrImagePath: this.config.qrImagePath,
      };

      const toolResults: any[] = [];
      for (const tu of res.toolUses) {
        const { result, confirmedOrderId } = await runTool(tu.name, tu.input, ctx);
        if (confirmedOrderId) {
          session.lastOrderId = confirmedOrderId;
          const order = await this.orders.getById(confirmedOrderId);
          if (order && order.status === "pending_review") await this.notifyStaffPendingReview(order);
        }
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
      }
      session.history.push({ role: "user", content: toolResults });
      this.store.save(session);
    }

    this.store.save(session);
    return replies;
  }

  async handleImage(phone: string, mediaId: string): Promise<void> {
    const session = this.store.get(phone);
    const orderId = session.lastOrderId;
    if (!orderId) {
      await this.whatsapp.sendText(
        phone,
        "Recibimos tu imagen, pero primero necesitamos cerrar el pedido. ¿Qué te gustaría pedir? 🍗",
      );
      return;
    }
    const { bytes, ext } = await this.whatsapp.downloadMedia(mediaId);
    const path = await this.storage.save(orderId, bytes, ext);
    const order = await this.orders.attachProof(orderId, path);
    await this.whatsapp.sendText(
      phone,
      "¡Gracias! Recibimos tu comprobante. Tu pago queda *en revisión* y te confirmamos apenas lo validemos. 🙌",
    );
    await this.notifyStaffPendingReview(order);
  }

  async notifyStaffPendingReview(order: Order): Promise<void> {
    const items = order.items.map((i) => `  • ${i.quantity} x ${i.name}`).join("\n");
    const method = order.paymentMethod === "transfer" ? "Transferencia (con comprobante)" : "Efectivo contra entrega";
    const summary = [
      `🔔 Pedido #${order.id} PENDIENTE DE REVISIÓN`,
      `Cliente: ${order.customerName} (${order.customerPhone})`,
      `Dirección: ${order.deliveryAddress} (${order.zone})`,
      items,
      `Total: $${order.totalCop.toLocaleString("es-CO")}`,
      `Pago: ${method}`,
      "",
      `Responde: aprobar #${order.id}  /  rechazar #${order.id} <motivo>`,
    ].join("\n");
    await this.whatsapp.sendText(this.config.staffChatId, summary);
    if (order.proofImagePath) {
      await this.whatsapp.sendImage(this.config.staffChatId, order.proofImagePath, `Comprobante #${order.id}`);
    }
  }
}

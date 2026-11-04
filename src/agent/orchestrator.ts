import { Inject, Injectable, Optional } from "@nestjs/common";
import { LLM_CLIENT, type LlmClient } from "./llmClient";
import { SESSION_STORE, type SessionStore } from "../sessions/sessionStore";
import { OrderService } from "../orders/orderService";
import { WHATSAPP_CLIENT, type WhatsAppClient } from "../whatsapp/client";
import { PROOF_STORAGE, type ProofStorage } from "../storage/proofStorage";
import { BOT_CONFIG, type BotConfig } from "../bot/botConfig";
import { mapsLink, type Order } from "../domain/order";
import { RECEIPT_CHECKER, describeReceipt, type ReceiptChecker } from "./receiptChecker";
import { CLOSED_HOURS_CONTACTS, type ClosedHoursContacts } from "../sessions/closedHoursContacts";
import { buildSystemPrompt } from "./prompt";
import { TOOL_DEFS, runTool, type ToolContext } from "./tools";
import { isOpen, hoursText } from "../config/businessHours";
import { findProductByRetailerId } from "../config/menu";
import { quoteDelivery } from "../config/delivery";
import type { CatalogOrderItem } from "../whatsapp/webhook";

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
    @Optional() @Inject(RECEIPT_CHECKER) private receipts?: ReceiptChecker,
    @Optional() @Inject(CLOSED_HOURS_CONTACTS) private closedContacts?: ClosedHoursContacts,
  ) {}

  async handleText(phone: string, text: string): Promise<string[]> {
    if (!isOpen(this.config.now())) {
      const msg = `¡Hola! En este momento estamos cerrados. ${hoursText()} Te escribimos apenas abramos. 🍗`;
      await this.closedContacts?.remember(phone, this.config.now());
      await this.whatsapp.sendText(phone, msg);
      return [msg];
    }

    await this.closedContacts?.forget(phone);
    await this.store.load(phone);
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
        let result: string;
        let confirmedOrderId: string | undefined;
        try {
          ({ result, confirmedOrderId } = await runTool(tu.name, tu.input, ctx));
        } catch (err) {
          // Never leave the customer hanging: report the failure to the model so it can recover.
          console.error(`Tool ${tu.name} failed:`, (err as Error).message);
          result = `Error técnico en ${tu.name}. Sigue la conversación sin esa herramienta.`;
        }
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

  /** Cart sent from the WhatsApp catalog: add items to the draft, then let the agent continue. */
  async handleOrder(phone: string, items: CatalogOrderItem[]): Promise<string[]> {
    if (!isOpen(this.config.now())) return this.handleText(phone, "");

    await this.store.load(phone);
    const session = this.store.get(phone);
    const lines: string[] = [];
    for (const item of items) {
      const product = findProductByRetailerId(item.retailerId);
      const productId = product?.id ?? item.retailerId;
      const name = product?.name ?? `Producto del catálogo ${item.retailerId}`;
      const existing = session.draft.items.find((i) => i.productId === productId);
      if (existing) existing.quantity += item.quantity;
      else session.draft.items.push({ productId, name, quantity: item.quantity, unitPriceCop: item.priceCop });
      lines.push(`- ${item.quantity} x ${name} ($${item.priceCop.toLocaleString("es-CO")})`);
    }
    this.store.save(session);
    return this.handleText(phone, ["[Pedido desde el catálogo]", ...lines].join("\n"));
  }

  /** Location shared by the customer: quote delivery by distance, then let the agent continue. */
  async handleLocation(phone: string, lat: number, lng: number): Promise<string[]> {
    if (!isOpen(this.config.now())) return this.handleText(phone, "");

    await this.store.load(phone);
    const session = this.store.get(phone);
    const quote = quoteDelivery({ lat, lng });
    let note: string;
    session.draft.deliveryLat = lat;
    session.draft.deliveryLng = lng;
    if (quote.covered) {
      session.draft.zone = `${quote.km} km`;
      session.draft.deliveryFeeCop = quote.feeCop;
      note = `distancia aprox. ${quote.km} km, domicilio $${quote.feeCop.toLocaleString("es-CO")}.`;
    } else {
      session.draft.zone = undefined;
      session.draft.deliveryFeeCop = 0;
      note = `distancia aprox. ${quote.km} km, FUERA de cobertura.`;
    }
    this.store.save(session);
    return this.handleText(phone, `[Ubicación compartida] ${note}`);
  }

  async handleImage(phone: string, mediaId: string): Promise<void> {
    await this.store.load(phone);
    const session = this.store.get(phone);
    const orderId = session.lastOrderId;
    if (!orderId) {
      await this.whatsapp.sendText(
        phone,
        "Recibimos tu imagen, pero primero necesitamos cerrar el pedido. ¿Qué te gustaría pedir? 🍗",
      );
      return;
    }
    const pending = await this.orders.getById(orderId);
    if (!pending || pending.status !== "awaiting_payment") {
      await this.whatsapp.sendText(phone, "Ya tenemos tu comprobante y está en revisión. Te avisamos apenas lo validemos. 🙌");
      return;
    }
    const { bytes, ext } = await this.whatsapp.downloadMedia(mediaId);

    let proofCheck: string | null = null;
    if (this.receipts) {
      try {
        const reading = await this.receipts.read(bytes, ext);
        if (!reading.isPaymentReceipt) {
          await this.whatsapp.sendText(
            phone,
            "Mmm, esa imagen no parece un comprobante de pago 🤔 Envíanos la captura de la transferencia, por favor.",
          );
          return;
        }
        proofCheck = describeReceipt(reading, pending.totalCop);
      } catch (err) {
        // Reading is a convenience; staff still reviews the image.
        console.error("Receipt check failed:", (err as Error).message);
        proofCheck = "No se pudo leer automáticamente. Revisa la imagen.";
      }
    }

    const path = await this.storage.save(orderId, bytes, ext);
    const order = await this.orders.attachProof(orderId, path, proofCheck);
    await this.whatsapp.sendText(
      phone,
      "¡Gracias! Recibimos tu comprobante. Tu pago queda *en revisión* y te confirmamos apenas lo validemos. 🙌",
    );
    await this.notifyStaffPendingReview(order);
  }

  async notifyStaffPendingReview(order: Order): Promise<void> {
    const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;
    const items = order.items.map((i) => `${i.quantity} x ${i.name}`).join(", ");
    const payment =
      order.paymentMethod === "transfer"
        ? `Transferencia. ${order.proofCheck ?? "Revisa el comprobante."}`
        : "Efectivo contra entrega";
    const params = [
      order.id,
      `${order.customerName} (${order.customerPhone})`,
      order.deliveryAddress,
      mapsLink(order),
      items,
      `${cop(order.totalCop)} (domicilio ${cop(order.deliveryFeeCop)})`,
      payment,
    ];
    try {
      // Template, not free text: staff may be outside WhatsApp's 24h window.
      await this.whatsapp.sendTemplate(this.config.staffChatId, "pedido_pendiente_revision", params, [
        `proof:${order.id}`,
        `approve:${order.id}`,
      ]);
    } catch (err) {
      // e.g. template not approved yet: free text still works inside the 24h window.
      console.error("Staff template failed, falling back to text:", (err as Error).message);
      const [id, customer, address, map, products, total, pay] = params;
      await this.whatsapp.sendText(
        this.config.staffChatId,
        [
          `🔔 Pedido #${id} PENDIENTE DE REVISIÓN`,
          `Cliente: ${customer}`,
          `Dirección: ${address}`,
          `Mapa: ${map}`,
          `Productos: ${products}`,
          `Total: ${total}`,
          `Pago: ${pay}`,
          "",
          `Responde: aprobar #${id}  /  rechazar #${id} <motivo>`,
        ].join("\n"),
      );
      if (order.proofImagePath) {
        await this.whatsapp.sendImage(this.config.staffChatId, order.proofImagePath, `Comprobante #${id}`);
      }
    }
  }
}

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
import type { Session } from "../sessions/sessionStore";

const MAX_TOOL_ROUNDS = 8;

/** Tools that send their own message to the customer: the turn ends right after them (no extra LLM call). */
const TERMINAL_TOOLS = new Set(["request_location", "send_catalog", "send_qr"]);
/** Their interactive message already says it all, so any text the model wrote alongside is dropped. */
const SELF_EXPLANATORY_TOOLS = new Set(["request_location", "send_catalog"]);

/** Don't repeat the "technical problem" apology to the same customer more often than this. */
const OUTAGE_NOTICE_EVERY_MS = 10 * 60 * 1000;

const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;

/** First name from the WhatsApp profile, only if it looks like a real name ("Santiago Palacio" -> "Santiago"). */
export function greetingName(profileName?: string): string | null {
  const first = profileName?.trim().split(/\s+/)[0] ?? "";
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,20}$/.test(first)) return null;
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

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

  async handleText(phone: string, text: string, profileName?: string): Promise<string[]> {
    if (!isOpen(this.config.now())) {
      const msg = `¡Hola! En este momento estamos cerrados. ${hoursText()} Te escribimos apenas abramos. 🍗`;
      await this.closedContacts?.remember(phone, this.config.now());
      await this.whatsapp.sendText(phone, msg);
      return [msg];
    }

    await this.closedContacts?.forget(phone);
    await this.store.load(phone);
    const session = this.store.get(phone);
    const isFirstMessage = session.history.length === 0;
    let intro = "";
    if (isFirstMessage) {
      // Greeting is sent by code: reliable and costs no tokens.
      const name = greetingName(profileName);
      await this.whatsapp.sendText(phone, `¡Hola${name ? ` ${name}` : ""}! 👋 Bienvenido/a a Ali~club 🍔🍗`);
      intro = `[El sistema ya saludó al cliente${name ? ` (${name})` : ""}; no vuelvas a saludar]\n`;
    }
    session.history.push({ role: "user", content: [{ type: "text", text: intro + text }] });

    const system = buildSystemPrompt();
    const replies: string[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let res;
      try {
        res = await this.llm.complete(system, session.history, TOOL_DEFS);
      } catch (err) {
        // Claude unavailable: the customer must not be left on read. Staff sees the chat in the Business app.
        console.error("LLM call failed:", (err as Error).message);
        await this.handleOutage(phone);
        break;
      }

      // History keeps the model's content unchanged (thinking blocks must round-trip as-is).
      const assistantContent: any[] = res.raw ? [...res.raw] : [];
      if (!res.raw) {
        if (res.text) assistantContent.push({ type: "text", text: res.text });
        for (const tu of res.toolUses) {
          assistantContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
        }
      }
      session.history.push({ role: "assistant", content: assistantContent });

      // The interactive message already says it all: don't also send the model's text.
      if (res.toolUses.some((t) => SELF_EXPLANATORY_TOOLS.has(t.name))) res = { ...res, text: "" };

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
        qrImagePath: this.config.qrImagePath,
      };

      const toolResults: any[] = [];
      let terminalSent = false;
      for (const tu of res.toolUses) {
        let result: string;
        let confirmedOrderId: string | undefined;
        try {
          ({ result, confirmedOrderId } = await runTool(tu.name, tu.input, ctx));
          if (TERMINAL_TOOLS.has(tu.name)) terminalSent = true;
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
      if (terminalSent) break;
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
    const subtotal = session.draft.items.reduce((sum, i) => sum + i.quantity * i.unitPriceCop, 0);
    const reply = `🛒 ¡Recibido! Tu pedido:\n${lines.join("\n")}\nSubtotal: ${cop(subtotal)}`;
    // Handled without the LLM: the next step is always the same.
    this.appendExchange(session, ["[Pedido desde el catálogo]", ...lines].join("\n"), reply);
    await this.whatsapp.sendText(phone, reply);
    await this.askNextDeliveryStep(phone, session);
    return [reply];
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
    // Handled without the LLM: the reply depends only on the quote and what's missing.
    let reply: string;
    if (!quote.covered) {
      reply = `Uy, qué pena 😔 esa ubicación queda a unos ${quote.km} km y no alcanzamos a llegar hasta allá. Si quieres, compárteme otra ubicación 📍`;
    } else if (session.draft.items.length === 0) {
      reply = `📍 ¡Sí llegamos! Domicilio: ${cop(quote.feeCop)}. ¿Qué te gustaría pedir?`;
    } else if (!session.draft.customerName || !session.draft.deliveryAddress) {
      reply = `📍 ¡Sí llegamos! Domicilio: ${cop(quote.feeCop)}.\nAhora envíame tu *nombre* y la *dirección* con apto/casa y una referencia para el domiciliario.`;
    } else {
      reply = `📍 Domicilio: ${cop(quote.feeCop)}. ¿Pagas por *transferencia* o en *efectivo* contra entrega?`;
    }
    this.appendExchange(session, `[Ubicación compartida] ${note}`, reply);
    await this.whatsapp.sendText(phone, reply);
    return [reply];
  }

  /** Records a bot-handled exchange so the LLM keeps the context on the next message. */
  private appendExchange(session: Session, userNote: string, reply: string): void {
    session.history.push({ role: "user", content: [{ type: "text", text: userNote }] });
    session.history.push({ role: "assistant", content: [{ type: "text", text: reply }] });
    this.store.save(session);
  }

  private async askNextDeliveryStep(phone: string, session: Session): Promise<void> {
    if (!session.draft.zone) {
      await this.whatsapp.sendLocationRequest(phone, "Para calcular el domicilio, compártenos tu ubicación con el botón de abajo 📍");
    } else if (!session.draft.customerName || !session.draft.deliveryAddress) {
      await this.whatsapp.sendText(phone, "Envíame tu *nombre* y la *dirección* con apto/casa y una referencia para el domiciliario.");
    } else {
      await this.whatsapp.sendText(phone, "¿Pagas por *transferencia* o en *efectivo* contra entrega?");
    }
  }

  private lastOutageNotice = new Map<string, number>();

  private async handleOutage(phone: string): Promise<void> {
    const now = this.config.now().getTime();
    if (now - (this.lastOutageNotice.get(phone) ?? 0) < OUTAGE_NOTICE_EVERY_MS) return;
    this.lastOutageNotice.set(phone, now);
    await this.whatsapp.sendText(
      phone,
      "Uy, estamos con un problema técnico 🙏 Ya le avisamos al equipo y en un momento te atienden por aquí mismo.",
    );
    for (const staff of this.config.staffChatIds) {
      try {
        await this.whatsapp.sendText(staff, `⚠️ El bot no pudo responder a +${phone}. Atiéndelo desde la app de WhatsApp Business.`);
      } catch (err) {
        console.error("Outage staff alert failed:", (err as Error).message);
      }
    }
  }

  /** Voice note: use Kapso's transcript as if the customer had typed it. */
  async handleAudio(phone: string, messageId: string, profileName?: string): Promise<string[]> {
    if (!isOpen(this.config.now())) return this.handleText(phone, "", profileName);
    const transcript = await this.whatsapp.getTranscript(messageId);
    if (!transcript) {
      const msg = "No pude escuchar bien tu audio 🙉 ¿Me lo escribes, porfa?";
      await this.whatsapp.sendText(phone, msg);
      return [msg];
    }
    return this.handleText(phone, `[Nota de voz transcrita] ${transcript}`, profileName);
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
      String(order.number),
      `${order.customerName} (${order.customerPhone})`,
      order.deliveryAddress,
      mapsLink(order),
      items,
      `${cop(order.totalCop)} (domicilio ${cop(order.deliveryFeeCop)})`,
      payment,
    ];
    // One staff member failing (e.g. outside the 24h window) must not block the others.
    for (const staff of this.config.staffChatIds) {
      try {
        await this.notifyOneStaff(staff, order, params);
      } catch (err) {
        console.error(`Staff alert to ${staff} failed:`, (err as Error).message);
      }
    }
  }

  private async notifyOneStaff(staff: string, order: Order, params: string[]): Promise<void> {
    try {
      // Template, not free text: staff may be outside WhatsApp's 24h window.
      await this.whatsapp.sendTemplate(staff, "pedido_pendiente_revision", params, [
        `proof:${order.number}`,
        `approve:${order.number}`,
      ]);
    } catch (err) {
      // e.g. template not approved yet: free text still works inside the 24h window.
      console.error("Staff template failed, falling back to text:", (err as Error).message);
      const [id, customer, address, map, products, total, pay] = params;
      await this.whatsapp.sendText(
        staff,
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
        await this.whatsapp.sendImage(staff, order.proofImagePath, `Comprobante #${id}`);
      }
    }
  }
}

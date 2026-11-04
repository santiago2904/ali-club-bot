import { getMenu, findProduct } from "../config/menu";
import type { OrderService } from "../orders/orderService";
import type { Session, SessionStore } from "../sessions/sessionStore";
import type { WhatsAppClient } from "../whatsapp/client";
import { calcSubtotalCop, calcTotalCop, emptyDraft, type PaymentMethod } from "../domain/order";

export interface ToolContext {
  session: Session;
  store: SessionStore;
  orders: OrderService;
  whatsapp: WhatsAppClient;
  staffChatId: string;
  qrImagePath: string;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

export const TOOL_DEFS: ToolDef[] = [
  { name: "get_menu", description: "Devuelve el menú con productos y precios.", input_schema: { type: "object", properties: {} } },
  { name: "request_location", description: "Pide al cliente compartir su ubicación de WhatsApp para calcular el domicilio por distancia.", input_schema: { type: "object", properties: {} } },
  { name: "add_item", description: "Agrega un producto al pedido por su productId.", input_schema: { type: "object", properties: { productId: { type: "string" }, quantity: { type: "integer", minimum: 1 } }, required: ["productId", "quantity"] } },
  { name: "remove_item", description: "Quita un producto del pedido por su productId.", input_schema: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"] } },
  { name: "set_customer_details", description: "Guarda el nombre del cliente y los detalles para encontrar la casa (dirección, apto/casa, referencias).", input_schema: { type: "object", properties: { name: { type: "string" }, address: { type: "string", description: "Dirección con apto/casa/torre y referencias para el domiciliario." } }, required: ["name", "address"] } },
  { name: "summarize_order", description: "Devuelve el resumen del pedido con totales.", input_schema: { type: "object", properties: {} } },
  { name: "confirm_order", description: "Confirma el pedido con el método de pago (transfer o cash).", input_schema: { type: "object", properties: { paymentMethod: { type: "string", enum: ["transfer", "cash"] } }, required: ["paymentMethod"] } },
  { name: "send_catalog", description: "Envía al cliente el catálogo interactivo de WhatsApp para que arme su carrito.", input_schema: { type: "object", properties: {} } },
  { name: "get_best_sellers", description: "Devuelve los productos más pedidos (datos reales de pedidos aprobados en los últimos 30 días).", input_schema: { type: "object", properties: {} } },
  { name: "send_qr", description: "Envía el código QR de pago por transferencia al cliente.", input_schema: { type: "object", properties: {} } },
];

function cop(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

export async function runTool(
  name: string,
  input: any,
  ctx: ToolContext,
): Promise<{ result: string; confirmedOrderId?: string }> {
  const draft = ctx.session.draft;

  switch (name) {
    case "get_menu": {
      const lines = getMenu().map((p) => `- ${p.id}: ${p.name} — ${cop(p.priceCop)}`);
      return { result: `Menú:\n${lines.join("\n")}` };
    }

    case "request_location": {
      await ctx.whatsapp.sendLocationRequest(
        ctx.session.phone,
        "Para calcular el domicilio, compártenos tu ubicación con el botón de abajo 📍",
      );
      return { result: "Solicitud de ubicación enviada. Espera a que el cliente la comparta." };
    }

    case "add_item": {
      const product = findProduct(String(input.productId));
      if (!product) return { result: `El producto "${input.productId}" no existe en el menú.` };
      const qty = Number(input.quantity);
      const existing = draft.items.find((i) => i.productId === product.id);
      if (existing) existing.quantity += qty;
      else draft.items.push({ productId: product.id, name: product.name, quantity: qty, unitPriceCop: product.priceCop });
      ctx.store.save(ctx.session);
      return { result: `Agregado: ${qty} x ${product.name}.` };
    }

    case "remove_item": {
      draft.items = draft.items.filter((i) => i.productId !== String(input.productId));
      ctx.store.save(ctx.session);
      return { result: `Producto quitado del pedido.` };
    }

    case "set_customer_details": {
      draft.customerName = String(input.name);
      draft.deliveryAddress = String(input.address);
      ctx.store.save(ctx.session);
      return {
        result: draft.zone
          ? `Datos guardados. Domicilio ya calculado (${draft.zone}): ${cop(draft.deliveryFeeCop)}.`
          : "Datos guardados. Falta la ubicación para calcular el domicilio: usa request_location.",
      };
    }

    case "summarize_order": {
      if (draft.items.length === 0) return { result: "El pedido está vacío." };
      const subtotal = calcSubtotalCop(draft.items);
      const total = calcTotalCop(subtotal, draft.deliveryFeeCop);
      const lines = draft.items.map((i) => `- ${i.quantity} x ${i.name} (${cop(i.unitPriceCop)})`);
      return {
        result: [
          "Resumen del pedido:",
          ...lines,
          `Subtotal: ${cop(subtotal)}`,
          `Domicilio: ${cop(draft.deliveryFeeCop)}`,
          `Total: ${cop(total)}`,
          draft.customerName ? `Cliente: ${draft.customerName}` : "Falta nombre",
          draft.deliveryAddress ? `Dirección: ${draft.deliveryAddress}` : "Falta dirección",
        ].join("\n"),
      };
    }

    case "confirm_order": {
      const missing: string[] = [];
      if (draft.items.length === 0) missing.push("productos");
      if (!draft.customerName) missing.push("nombre");
      if (!draft.deliveryAddress) missing.push("dirección");
      if (!draft.zone) missing.push("ubicación con cobertura (request_location)");
      if (missing.length) return { result: `Falta información: ${missing.join(", ")}.` };

      const method = input.paymentMethod as PaymentMethod;
      const order = await ctx.orders.confirm(ctx.session.phone, draft, method);
      ctx.session.draft = emptyDraft();
      ctx.store.save(ctx.session);
      const total = cop(order.totalCop);
      if (method === "transfer") {
        return {
          result: `Pedido #${order.id} creado por ${total}. Pago por transferencia: envía el QR y pide el comprobante.`,
          confirmedOrderId: order.id,
        };
      }
      return {
        result: `Pedido #${order.id} creado por ${total}. Pago en efectivo contra entrega. Queda pendiente de confirmación del local.`,
        confirmedOrderId: order.id,
      };
    }

    case "send_catalog": {
      try {
        await ctx.whatsapp.sendCatalog(ctx.session.phone, "Mira nuestro menú y arma tu pedido desde el catálogo 🍔🍗");
        return { result: "Catálogo enviado. No repitas el menú en texto." };
      } catch (err) {
        console.error("send_catalog failed:", (err as Error).message);
        return { result: "No se pudo enviar el catálogo. Muestra el menú en texto con get_menu." };
      }
    }

    case "get_best_sellers": {
      const top = await ctx.orders.bestSellers();
      if (top.length === 0) {
        return { result: "Aún no hay datos suficientes. NO digas que algún producto es el más pedido o el favorito." };
      }
      return { result: `Más pedidos (últimos 30 días):\n${top.map((t) => `- ${t.name}`).join("\n")}` };
    }

    case "send_qr": {
      await ctx.whatsapp.sendImage(
        ctx.session.phone,
        ctx.qrImagePath,
        "Escanea este QR para pagar por transferencia y envíanos la foto del comprobante.",
      );
      return { result: "QR de pago enviado al cliente." };
    }

    default:
      return { result: `Herramienta desconocida: ${name}.` };
  }
}

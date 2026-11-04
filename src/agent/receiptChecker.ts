import Anthropic from "@anthropic-ai/sdk";

export const RECEIPT_CHECKER = Symbol("ReceiptChecker");

export interface ReceiptReading {
  isPaymentReceipt: boolean;
  amountCop: number | null;
  bank: string | null;
  date: string | null;
  reference: string | null;
}

/** Reads a payment screenshot. Only informs staff — it never approves a payment. */
export interface ReceiptChecker {
  read(image: Buffer, ext: string): Promise<ReceiptReading>;
}

export function describeReceipt(r: ReceiptReading, expectedTotalCop: number): string {
  const cop = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const parts = [r.bank ?? "Banco no identificado"];
  parts.push(r.amountCop != null ? cop(r.amountCop) : "monto ilegible");
  if (r.date) parts.push(r.date);
  if (r.reference) parts.push(`ref ${r.reference}`);
  const amountOk = r.amountCop === expectedTotalCop;
  const flag = amountOk ? "✅ monto coincide" : `⚠️ el pedido es ${cop(expectedTotalCop)}`;
  return `Comprobante leído: ${parts.join(", ")} (${flag}). Verifica en el banco antes de aprobar.`;
}

/** The model sometimes writes placeholders like "UNKNOWN" instead of null. */
export function cleanField(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return !t || /^(unknown|n\/?a|null|none|desconocido|no identificado|-)$/i.test(t) ? null : t;
}

const MEDIA_TYPES: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
};

export class AnthropicReceiptChecker implements ReceiptChecker {
  private client: Anthropic;
  constructor(apiKey: string, private model = "claude-haiku-5-5") {
    // Fail fast in a chat (the SDK default is 10 min); the SDK still retries 429/5xx twice.
    this.client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
  }

  async read(image: Buffer, ext: string): Promise<ReceiptReading> {
    // `as any`: the installed SDK (0.32) predates output_config typings.
    const res: any = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      output_config: { effort: "low" },
      tool_choice: { type: "tool", name: "report_receipt" },
      tools: [{
        name: "report_receipt",
        description: "Reporta lo que muestra la imagen.",
        input_schema: {
          type: "object",
          properties: {
            is_payment_receipt: { type: "boolean", description: "true solo si es una captura/comprobante de transferencia o pago bancario (Bancolombia, Nequi, Daviplata, Bre-B, etc.)." },
            amount_cop: { type: ["integer", "null"], description: "Monto transferido en pesos, sin decimales." },
            bank: { type: ["string", "null"] },
            date: { type: ["string", "null"], description: "Fecha y hora tal como aparecen." },
            reference: { type: ["string", "null"], description: "Número de comprobante o referencia." },
          },
          required: ["is_payment_receipt", "amount_cop", "bank", "date", "reference"],
        },
      }],
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: MEDIA_TYPES[ext.toLowerCase()] ?? "image/jpeg", data: image.toString("base64") } },
          { type: "text", text: "¿Esta imagen es un comprobante de pago? Extrae los datos si lo es." },
        ],
      }],
    } as any);
    const block = res.content.find((b: any) => b.type === "tool_use");
    const input = (block?.type === "tool_use" ? block.input : {}) as any;
    return {
      isPaymentReceipt: Boolean(input.is_payment_receipt),
      amountCop: typeof input.amount_cop === "number" ? input.amount_cop : null,
      bank: cleanField(input.bank),
      date: cleanField(input.date),
      reference: cleanField(input.reference),
    };
  }
}

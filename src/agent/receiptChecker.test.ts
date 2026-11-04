import { describe, it, expect } from "vitest";
import { cleanField, describeReceipt } from "./receiptChecker";

const base = { isPaymentReceipt: true, bank: "Bancolombia", date: "4 nov 2026", reference: "123" };

describe("describeReceipt", () => {
  it("marks a matching amount", () => {
    const s = describeReceipt({ ...base, amountCop: 37000 }, 37000);
    expect(s).toContain("Bancolombia");
    expect(s).toContain("✅ monto coincide");
  });

  it("flags an amount that does not match the order total", () => {
    expect(describeReceipt({ ...base, amountCop: 30000 }, 37000)).toContain("⚠️ el pedido es $37.000");
  });

  it("flags an unreadable amount", () => {
    const s = describeReceipt({ ...base, amountCop: null }, 37000);
    expect(s).toContain("monto ilegible");
    expect(s).toContain("⚠️");
  });

  it("always reminds staff to verify in the bank", () => {
    expect(describeReceipt({ ...base, amountCop: 37000 }, 37000)).toContain("Verifica en el banco");
  });
});

describe("cleanField", () => {
  it("drops placeholder values the model writes instead of null", () => {
    for (const v of ["UNKNOWN", "unknown", "N/A", "", "  ", null, undefined, "Desconocido"]) {
      expect(cleanField(v)).toBeNull();
    }
    expect(cleanField(" Bancolombia ")).toBe("Bancolombia");
  });
});

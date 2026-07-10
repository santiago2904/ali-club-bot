import { describe, it, expect } from "vitest";
import { getMenu, findProduct } from "./menu";

describe("menu", () => {
  it("returns products with positive integer COP prices", () => {
    const menu = getMenu();
    expect(menu.length).toBeGreaterThan(0);
    for (const p of menu) {
      expect(Number.isInteger(p.priceCop)).toBe(true);
      expect(p.priceCop).toBeGreaterThan(0);
    }
  });

  it("finds a product by id and returns undefined for unknown", () => {
    const first = getMenu()[0];
    expect(findProduct(first.id)?.id).toBe(first.id);
    expect(findProduct("nope")).toBeUndefined();
  });
});

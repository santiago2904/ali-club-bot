import { describe, it, expect } from "vitest";
import { validateZone } from "./zones";

describe("validateZone", () => {
  it("matches a covered neighborhood ignoring case and whitespace", () => {
    const r = validateZone("  LAURELES ");
    expect(r.covered).toBe(true);
    expect(r.deliveryFeeCop).toBeGreaterThanOrEqual(0);
  });

  it("normalizes accents", () => {
    expect(validateZone("belén").covered).toBe(validateZone("belen").covered);
  });

  it("returns not covered for unknown neighborhood", () => {
    expect(validateZone("narnia").covered).toBe(false);
  });
});

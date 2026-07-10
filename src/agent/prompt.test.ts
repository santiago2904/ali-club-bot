import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("is in Spanish and forbids inventing data", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/alitas/i);
    expect(p).toMatch(/nunca inventes/i);
    expect(p).toMatch(/herramientas/i);
  });
});

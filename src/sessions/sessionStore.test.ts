import { describe, it, expect } from "vitest";
import { MemorySessionStore } from "./sessionStore";

describe("MemorySessionStore", () => {
  it("creates a fresh empty session on first get", () => {
    const store = new MemorySessionStore();
    const s = store.get("573001112233");
    expect(s.phone).toBe("573001112233");
    expect(s.draft.items).toEqual([]);
    expect(s.history).toEqual([]);
  });

  it("persists mutations across gets via save", () => {
    const store = new MemorySessionStore();
    const s = store.get("57300");
    s.draft.customerName = "Ana";
    store.save(s);
    expect(store.get("57300").draft.customerName).toBe("Ana");
  });

  it("reset clears the session", () => {
    const store = new MemorySessionStore();
    const s = store.get("57300");
    s.draft.customerName = "Ana";
    store.save(s);
    store.reset("57300");
    expect(store.get("57300").draft.customerName).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { PrismaSessionStore, SESSION_TTL_MS } from "./prismaSessionStore";

/** Minimal in-memory stand-in for prisma.conversation. */
function fakePrisma() {
  const rows = new Map<string, any>();
  return {
    rows,
    conversation: {
      findUnique: async ({ where }: any) => rows.get(where.phone) ?? null,
      upsert: async ({ where, create, update }: any) => {
        rows.set(where.phone, rows.has(where.phone) ? { ...rows.get(where.phone), ...update } : create);
      },
      delete: async ({ where }: any) => rows.delete(where.phone),
    },
  };
}

describe("PrismaSessionStore", () => {
  it("survives a restart: a new store instance reloads the conversation from the DB", async () => {
    const prisma = fakePrisma();
    const first = new PrismaSessionStore(prisma as any);
    await first.load("57300");
    const s = first.get("57300");
    s.draft.customerName = "Ana";
    s.history.push({ role: "user", content: "hola" });
    first.save(s);
    await first.flush();

    const restarted = new PrismaSessionStore(prisma as any);
    await restarted.load("57300");
    expect(restarted.get("57300").draft.customerName).toBe("Ana");
    expect(restarted.get("57300").history).toHaveLength(1);
  });

  it("starts fresh after the TTL but keeps lastOrderId for late payment proofs", async () => {
    const prisma = fakePrisma();
    let now = new Date(2026, 10, 4, 12, 0);
    const store = new PrismaSessionStore(prisma as any, () => now);
    await store.load("57300");
    const s = store.get("57300");
    s.history.push({ role: "user", content: "hola" });
    s.lastOrderId = "9";
    store.save(s);
    await store.flush();

    now = new Date(now.getTime() + SESSION_TTL_MS + 1000);
    await store.load("57300");
    expect(store.get("57300").history).toEqual([]);
    expect(store.get("57300").lastOrderId).toBe("9");
  });
});

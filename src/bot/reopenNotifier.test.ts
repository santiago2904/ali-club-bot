import { describe, it, expect } from "vitest";
import { ReopenNotifier, REOPEN_MESSAGE } from "./reopenNotifier";
import { MemoryClosedHoursContacts } from "../sessions/closedHoursContacts";
import { FakeWhatsAppClient } from "../whatsapp/client";
import type { BotConfig } from "./botConfig";

const OPEN = new Date(2026, 6, 9, 19, 0);
const CLOSED = new Date(2026, 6, 9, 4, 0);

function setup(now: Date) {
  const contacts = new MemoryClosedHoursContacts();
  const wa = new FakeWhatsAppClient();
  const config: BotConfig = { allowedSenders: "*", staffChatId: "staff-1", qrImagePath: "/qr.png", now: () => now };
  return { contacts, wa, notifier: new ReopenNotifier(contacts, wa, config) };
}

describe("ReopenNotifier", () => {
  it("does nothing while closed and keeps the contacts", async () => {
    const { contacts, wa, notifier } = setup(CLOSED);
    await contacts.remember("57300", CLOSED);
    expect(await notifier.tick()).toBe(0);
    expect(wa.sent).toEqual([]);
    expect(await contacts.drain()).toHaveLength(1);
  });

  it("greets customers who wrote while closed once the store opens, only once", async () => {
    const { contacts, wa, notifier } = setup(OPEN);
    await contacts.remember("57300", new Date(OPEN.getTime() - 3 * 3600_000));
    expect(await notifier.tick()).toBe(1);
    expect(wa.sent).toEqual([{ to: "57300", kind: "text", text: REOPEN_MESSAGE }]);
    expect(await notifier.tick()).toBe(0);
  });

  it("skips contacts outside WhatsApp's 24h reply window", async () => {
    const { contacts, wa, notifier } = setup(OPEN);
    await contacts.remember("57300", new Date(OPEN.getTime() - 30 * 3600_000));
    expect(await notifier.tick()).toBe(0);
    expect(wa.sent).toEqual([]);
  });
});

import type { PrismaClient } from "@prisma/client";

export const CLOSED_HOURS_CONTACTS = Symbol("ClosedHoursContacts");

export interface ClosedContact {
  phone: string;
  lastMessageAt: Date;
}

/** Customers who wrote while closed, to greet them when the store opens. */
export interface ClosedHoursContacts {
  remember(phone: string, at: Date): Promise<void>;
  /** The customer is already talking to us while open: no greeting needed. */
  forget(phone: string): Promise<void>;
  /** Returns every remembered contact and forgets them. */
  drain(): Promise<ClosedContact[]>;
}

export class MemoryClosedHoursContacts implements ClosedHoursContacts {
  private contacts = new Map<string, Date>();
  async remember(phone: string, at: Date): Promise<void> {
    this.contacts.set(phone, at);
  }
  async forget(phone: string): Promise<void> {
    this.contacts.delete(phone);
  }
  async drain(): Promise<ClosedContact[]> {
    const all = [...this.contacts].map(([phone, lastMessageAt]) => ({ phone, lastMessageAt }));
    this.contacts.clear();
    return all;
  }
}

export class PrismaClosedHoursContacts implements ClosedHoursContacts {
  constructor(private prisma: PrismaClient) {}
  async remember(phone: string, at: Date): Promise<void> {
    await this.prisma.closedHoursContact.upsert({
      where: { phone },
      create: { phone, lastMessageAt: at },
      update: { lastMessageAt: at },
    });
  }
  async forget(phone: string): Promise<void> {
    await this.prisma.closedHoursContact.deleteMany({ where: { phone } });
  }
  async drain(): Promise<ClosedContact[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.closedHoursContact.findMany();
      await tx.closedHoursContact.deleteMany({ where: { phone: { in: rows.map((r) => r.phone) } } });
      return rows;
    });
  }
}

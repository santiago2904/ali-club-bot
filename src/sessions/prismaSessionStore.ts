import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { emptyDraft, type OrderDraft } from "../domain/order";
import type { LlmMessage, Session, SessionStore } from "./sessionStore";

/** A conversation idle longer than this starts fresh (keeps lastOrderId for late payment proofs). */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Write-through cache over Postgres so conversations survive restarts and deploys.
 * lazy: per-process cache assumes a single bot instance; drop the cache if scaling out.
 */
export class PrismaSessionStore implements SessionStore {
  private cache = new Map<string, Session>();
  private writes = new Map<string, Promise<void>>();
  private readonly logger = new Logger(PrismaSessionStore.name);

  constructor(private prisma: PrismaClient, private now: () => Date = () => new Date()) {}

  async load(phone: string): Promise<void> {
    let session = this.cache.get(phone);
    if (!session) {
      const row = await this.prisma.conversation.findUnique({ where: { phone } });
      session = row
        ? {
            phone,
            history: row.history as unknown as LlmMessage[],
            draft: row.draft as unknown as OrderDraft,
            lastOrderId: row.lastOrderId ?? undefined,
            updatedAt: row.updatedAt,
          }
        : this.fresh(phone);
    }
    if (this.now().getTime() - session.updatedAt.getTime() > SESSION_TTL_MS) {
      session = { ...this.fresh(phone), lastOrderId: session.lastOrderId };
    }
    this.cache.set(phone, session);
  }

  get(phone: string): Session {
    let session = this.cache.get(phone);
    if (!session) {
      session = this.fresh(phone);
      this.cache.set(phone, session);
    }
    return session;
  }

  save(session: Session): void {
    session.updatedAt = this.now();
    this.cache.set(session.phone, session);
    const data = {
      history: session.history as unknown as object,
      draft: session.draft as unknown as object,
      lastOrderId: session.lastOrderId ?? null,
      updatedAt: session.updatedAt,
    };
    // Chain writes per phone so an older snapshot never overwrites a newer one.
    const prev = this.writes.get(session.phone) ?? Promise.resolve();
    const next = prev
      .then(() => this.prisma.conversation.upsert({ where: { phone: session.phone }, create: { phone: session.phone, ...data }, update: data }))
      .then(() => undefined)
      .catch((err) => this.logger.error(`Failed to persist conversation: ${(err as Error).message}`));
    this.writes.set(session.phone, next);
  }

  reset(phone: string): void {
    this.cache.delete(phone);
    void this.prisma.conversation.delete({ where: { phone } }).catch(() => undefined);
  }

  /** For tests/shutdown: wait until pending writes hit the DB. */
  async flush(): Promise<void> {
    await Promise.all(this.writes.values());
  }

  private fresh(phone: string): Session {
    return { phone, history: [], draft: emptyDraft(), updatedAt: this.now() };
  }
}

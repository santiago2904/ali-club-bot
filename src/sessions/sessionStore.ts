import { emptyDraft, type OrderDraft } from "../domain/order";

export const SESSION_STORE = Symbol("SessionStore");

export interface LlmMessage {
  role: "user" | "assistant";
  content: unknown;
}

export interface Session {
  phone: string;
  history: LlmMessage[];
  draft: OrderDraft;
  updatedAt: Date;
  lastOrderId?: string;
}

export interface SessionStore {
  get(phone: string): Session;
  reset(phone: string): void;
  save(session: Session): void;
}

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  get(phone: string): Session {
    const existing = this.sessions.get(phone);
    if (existing) return existing;
    const fresh: Session = { phone, history: [], draft: emptyDraft(), updatedAt: new Date() };
    this.sessions.set(phone, fresh);
    return fresh;
  }

  reset(phone: string): void {
    this.sessions.delete(phone);
  }

  save(session: Session): void {
    session.updatedAt = new Date();
    this.sessions.set(session.phone, session);
  }
}

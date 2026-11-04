import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { isOpen } from "../config/businessHours";
import { CLOSED_HOURS_CONTACTS, type ClosedHoursContacts } from "../sessions/closedHoursContacts";
import { WHATSAPP_CLIENT, type WhatsAppClient } from "../whatsapp/client";
import { BOT_CONFIG, type BotConfig } from "./botConfig";

// WhatsApp allows free-form replies only within 24h of the customer's last message.
const REPLY_WINDOW_MS = 23 * 60 * 60 * 1000;

export const REOPEN_MESSAGE =
  "¡Hola! Ya abrimos 🍗🍔 Hace un rato nos escribiste, ¿qué se te antoja hoy? Si quieres te mando el menú.";

/** When the store opens, greets everyone who wrote while it was closed. */
@Injectable()
export class ReopenNotifier implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(ReopenNotifier.name);

  constructor(
    @Inject(CLOSED_HOURS_CONTACTS) private contacts: ClosedHoursContacts,
    @Inject(WHATSAPP_CLIENT) private whatsapp: WhatsAppClient,
    @Inject(BOT_CONFIG) private config: BotConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<number> {
    const now = this.config.now();
    if (!isOpen(now)) return 0;
    let sent = 0;
    for (const c of await this.contacts.drain()) {
      if (now.getTime() - c.lastMessageAt.getTime() > REPLY_WINDOW_MS) continue;
      try {
        await this.whatsapp.sendText(c.phone, REOPEN_MESSAGE);
        sent++;
      } catch (err) {
        this.logger.error(`Reopen greeting failed: ${(err as Error).message}`);
      }
    }
    return sent;
  }
}

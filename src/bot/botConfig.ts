export const BOT_CONFIG = Symbol("BotConfig");

export interface BotConfig {
  /** Staff who review orders. A staff number can also order as a customer (non-command messages). */
  staffChatIds: string[];
  /** Courier who receives approved orders; optional. */
  courierChatId?: string;
  qrImagePath: string;
  allowedSenders: "*" | string[];
  now: () => Date;
}

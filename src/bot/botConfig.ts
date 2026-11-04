export const BOT_CONFIG = Symbol("BotConfig");

export interface BotConfig {
  staffChatId: string;
  /** Courier who receives approved orders; optional. */
  courierChatId?: string;
  qrImagePath: string;
  allowedSenders: "*" | string[];
  now: () => Date;
}

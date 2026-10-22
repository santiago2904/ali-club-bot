export const BOT_CONFIG = Symbol("BotConfig");

export interface BotConfig {
  staffChatId: string;
  qrImagePath: string;
  allowedSenders: "*" | string[];
  now: () => Date;
}

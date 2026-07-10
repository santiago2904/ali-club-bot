export const BOT_CONFIG = Symbol("BotConfig");

export interface BotConfig {
  staffChatId: string;
  qrImagePath: string;
  now: () => Date;
}

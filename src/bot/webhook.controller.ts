import { Body, Controller, Get, Inject, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { parseWebhook } from "../whatsapp/webhook";
import { Orchestrator } from "../agent/orchestrator";
import { StaffController } from "../staff/control";
import { BOT_CONFIG, type BotConfig } from "./botConfig";

export const VERIFY_TOKEN = Symbol("VerifyToken");

@Controller()
export class WebhookController {
  private seen = new Set<string>();

  constructor(
    private orchestrator: Orchestrator,
    private staff: StaffController,
    @Inject(BOT_CONFIG) private config: BotConfig,
    @Inject(VERIFY_TOKEN) private verifyToken: string,
  ) {}

  @Get("health")
  health(): { ok: true } {
    return { ok: true };
  }

  @Get("webhook")
  verify(@Query() q: Record<string, string>, @Res() res: Response): void {
    if (q["hub.verify_token"] === this.verifyToken && q["hub.challenge"]) {
      res.status(200).send(q["hub.challenge"]);
      return;
    }
    res.status(403).send("Forbidden");
  }

  @Post("webhook")
  async receive(@Body() body: unknown): Promise<{ received: true }> {
    const messages = parseWebhook(body);
    for (const msg of messages) {
      if (this.seen.has(msg.messageId)) continue;
      this.seen.add(msg.messageId);

      try {
        if (msg.from === this.config.staffChatId) {
          if (msg.kind === "text") await this.staff.handle(msg.text, this.config.staffChatId);
          continue;
        }
        if (msg.kind === "text") await this.orchestrator.handleText(msg.from, msg.text);
        else await this.orchestrator.handleImage(msg.from, msg.mediaId);
      } catch {
        // Swallow per-message errors so one bad message can't 500 the whole batch.
      }
    }
    return { received: true };
  }
}

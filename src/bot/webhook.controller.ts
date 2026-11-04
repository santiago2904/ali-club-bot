import { Body, Controller, Get, Inject, Logger, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { parseWebhook } from "../whatsapp/webhook";
import { Orchestrator } from "../agent/orchestrator";
import { StaffController, parseStaffCommand } from "../staff/control";
import { BOT_CONFIG, type BotConfig } from "./botConfig";
import { WhatsAppSignatureGuard } from "./whatsappSignature.guard";

export const VERIFY_TOKEN = Symbol("VerifyToken");

@Controller()
export class WebhookController {
  private seen = new Set<string>();
  private readonly logger = new Logger(WebhookController.name);

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

  @UseGuards(WhatsAppSignatureGuard)
  @Post("webhook")
  async receive(@Body() body: unknown): Promise<{ received: true }> {
    const messages = parseWebhook(body);
    for (const msg of messages) {
      if (this.seen.has(msg.messageId)) continue;
      this.seen.add(msg.messageId);

      try {
        if (this.config.staffChatIds.includes(msg.from)) {
          // Only commands and template buttons are staff actions; anything else is a normal chat.
          if (msg.kind === "button") {
            await this.staff.handleButton(msg.payload, msg.from);
            continue;
          }
          if (msg.kind === "text" && parseStaffCommand(msg.text)) {
            await this.staff.handle(msg.text, msg.from);
            continue;
          }
        }
        if (this.config.allowedSenders !== "*" && !this.config.allowedSenders.includes(msg.from)) {
          this.logger.log(`Ignoring message ${msg.messageId} from sender outside ALLOWED_SENDERS`);
          continue;
        }
        if (msg.kind === "text") await this.orchestrator.handleText(msg.from, msg.text, msg.profileName);
        else if (msg.kind === "order") await this.orchestrator.handleOrder(msg.from, msg.items);
        else if (msg.kind === "location") await this.orchestrator.handleLocation(msg.from, msg.lat, msg.lng);
        else if (msg.kind === "image") await this.orchestrator.handleImage(msg.from, msg.mediaId);
        else if (msg.kind === "audio") await this.orchestrator.handleAudio(msg.from, msg.messageId, msg.profileName);
      } catch (err) {
        this.logger.error(`Failed to process message ${msg.messageId}`, err as Error);
      }
    }
    return { received: true };
  }
}

import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const APP_SECRET = Symbol("AppSecret");

@Injectable()
export class WhatsAppSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WhatsAppSignatureGuard.name);

  constructor(@Inject(APP_SECRET) private appSecret: string) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const header = req.header("x-hub-signature-256");
    if (!header || !header.startsWith("sha256=")) {
      this.logger.warn("Rejected webhook: missing X-Hub-Signature-256");
      return false;
    }
    const raw = req.rawBody;
    if (!raw) {
      this.logger.error("Rejected webhook: raw body unavailable (enable rawBody in bootstrap)");
      return false;
    }
    const expected = "sha256=" + createHmac("sha256", this.appSecret).update(raw).digest("hex");
    const received = Buffer.from(header);
    const computed = Buffer.from(expected);
    if (received.length !== computed.length) return false;
    return timingSafeEqual(received, computed);
  }
}

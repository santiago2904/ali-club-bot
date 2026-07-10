import { Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { getEnv } from "./config/env";
import { ORDER_REPOSITORY } from "./orders/orderRepository";
import { PrismaOrderRepository } from "./orders/prismaOrderRepository";
import { OrderService } from "./orders/orderService";
import { SESSION_STORE, MemorySessionStore } from "./sessions/sessionStore";
import { PROOF_STORAGE } from "./storage/proofStorage";
import { LocalProofStorage } from "./storage/localProofStorage";
import { WHATSAPP_CLIENT } from "./whatsapp/client";
import { CloudApiWhatsAppClient } from "./whatsapp/cloudApiClient";
import { LLM_CLIENT } from "./agent/llmClient";
import { AnthropicLlmClient } from "./agent/anthropicLlmClient";
import { Orchestrator } from "./agent/orchestrator";
import { StaffController } from "./staff/control";
import { BOT_CONFIG, type BotConfig } from "./bot/botConfig";
import { VERIFY_TOKEN, WebhookController } from "./bot/webhook.controller";

const env = getEnv();

const botConfig: BotConfig = {
  staffChatId: env.STAFF_CHAT_ID,
  qrImagePath: env.QR_IMAGE_PATH,
  now: () => new Date(),
};

@Module({
  controllers: [WebhookController],
  providers: [
    OrderService,
    Orchestrator,
    StaffController,
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    { provide: ORDER_REPOSITORY, useClass: PrismaOrderRepository },
    { provide: SESSION_STORE, useClass: MemorySessionStore },
    { provide: PROOF_STORAGE, useFactory: () => new LocalProofStorage(env.PROOF_DIR) },
    { provide: WHATSAPP_CLIENT, useFactory: () => new CloudApiWhatsAppClient(env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID) },
    { provide: LLM_CLIENT, useFactory: () => new AnthropicLlmClient(env.ANTHROPIC_API_KEY) },
    { provide: BOT_CONFIG, useValue: botConfig },
    { provide: VERIFY_TOKEN, useValue: env.WHATSAPP_VERIFY_TOKEN },
  ],
})
export class AppModule {}

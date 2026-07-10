import { z } from "zod";

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  WHATSAPP_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  STAFF_CHAT_ID: z.string().min(1),
  PROOF_DIR: z.string().min(1),
  QR_IMAGE_PATH: z.string().min(1),
  PORT: z.coerce.number().int().positive(),
  WHATSAPP_APP_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(raw: Record<string, string | undefined>): Env {
  return schema.parse(raw);
}

// Lazily loaded + cached so importing this module never validates process.env
// at import time (which would throw during tests where env vars are absent).
// Production consumers call getEnv() at runtime, after process.env is populated.
let cachedEnv: Env | undefined;

export function getEnv(): Env {
  if (!cachedEnv) cachedEnv = loadEnv(process.env);
  return cachedEnv;
}

# ali-club-bot

Bot de WhatsApp para tomar pedidos de alitas BBQ (MVP). NestJS + Express.

## Requisitos
- Node.js ≥ 20
- PostgreSQL en ejecución
- Credenciales de WhatsApp Cloud API y una API key de Anthropic

## Setup
1. `cp .env.example .env` y completa las variables.
2. `npm install`
3. `npx prisma migrate dev` (crea las tablas)
4. Coloca el QR de pago en `assets/payment-qr.png` (o ajusta `QR_IMAGE_PATH`).
5. `npm run start:dev`

## Pruebas
- `npm test` — corre toda la suite (unitaria + E2E con fakes).

## Verificación manual (E2E real)
1. Expón el servidor con un túnel (`cloudflared` / `ngrok`) y configura el webhook en Meta apuntando a `/webhook` con `WHATSAPP_VERIFY_TOKEN`.
2. Desde un número de prueba, escribe "hola" → el bot debe saludar y ofrecer el menú.
3. Pide productos, da nombre/dirección/barrio cubierto → confirma pedido por transferencia.
4. Verifica que llega el QR; envía una foto como comprobante.
5. Confirma que el pedido pasa a `pending_review` y que el chat interno (`STAFF_CHAT_ID`) recibe el resumen + comprobante.
6. Desde el chat interno responde `aprobar #<id>` → el cliente recibe la confirmación.
7. Repite con **efectivo** (salta el QR, va directo a `pending_review`) y con un **barrio sin cobertura** (el bot se disculpa y no toma el pedido).
8. Fuera de horario, el bot responde con el horario y no toma pedidos.

## Prerequisites (non-code, before real E2E)

These block live testing but not development (fakes cover it):

1. Meta Business account for the business.
2. Verify a phone number for WhatsApp Cloud API; obtain `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, set a `WHATSAPP_VERIFY_TOKEN`.
3. Payment account + fixed QR image at `assets/payment-qr.png` (`QR_IMAGE_PATH`).
4. Real menu items/prices → update `src/config/menu.ts`.
5. Real covered neighborhoods + delivery fees → update `src/config/zones.ts`.
6. Real business hours → update `src/config/businessHours.ts`.
7. Internal staff WhatsApp chat id → `STAFF_CHAT_ID`.
8. A running PostgreSQL for `prisma migrate dev`.

## Out of scope (Phase 2)

- Web admin panel (replaces the internal-chat approval channel; same state machine).
- Dynamic per-order QR / payment gateway.
- Menu variants, daily promos, half-and-half.
- Persisting sessions in the DB (MVP uses an in-memory session store — single instance only).
- Cloud proof storage (S3/R2) — swap `LocalProofStorage` for a cloud impl behind `ProofStorage`.
- Async webhook processing / queue (MVP processes inline before responding 200).

## Self-Review Notes

- **Spec coverage:** menu (T2/T9), zones+coverage (T2/T9), customer data (T9), order+pricing+states (T3/T7), transfer QR + proof → pending_review (T9/T11), cash → pending_review (T7/T9), human approve/reject via internal chat (T12/T13), out-of-hours + no-coverage + duplicate-webhook + never-auto-confirm (T11/T9/T13), English code / Spanish copy (all), COP integers (T3), NestJS DI with tokens + fakes for all externals (T4/T5/T6/T8/T10/T13). All covered.
- **Type consistency:** `OrderStatus`/`PaymentMethod`/`OrderItem`/`OrderDraft`/`Order` defined once in T3; `OrderRepository`/`CreateOrderInput`/`ORDER_REPOSITORY` in T4; `Session.lastOrderId` defined in T6 (before use in T11); `OrderService.getById` in T7 (before use in T11); `BotConfig`/`BOT_CONFIG` defined in T11 Step 3 (before use in T13); DI tokens (`ORDER_REPOSITORY`, `PROOF_STORAGE`, `SESSION_STORE`, `WHATSAPP_CLIENT`, `LLM_CLIENT`, `BOT_CONFIG`, `VERIFY_TOKEN`) each defined once beside their interface. Consistent.
- **NestJS decorator/test note:** unit tests always construct classes directly (`new`), so no DI reflection is needed at test time; `unplugin-swc` handles decorator syntax + metadata for anything that imports decorated classes. Production DI resolves through `AppModule` providers.
- **No placeholders:** every code step contains full code; config values are explicit placeholders flagged for business confirmation (not code gaps).

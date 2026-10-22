# Guía de pruebas — ali-club-bot

Dos niveles de prueba:

- **Nivel 1 — Suite automatizada:** valida toda la lógica con *fakes*. **Cero servicios externos.** Úsalo siempre (en cada cambio).
- **Nivel 2 — E2E real:** el flujo completo por WhatsApp de verdad. Requiere credenciales de Meta, una API key de Anthropic y Postgres.

> Nota importante: la app "cableada" (AppModule) usa los adaptadores reales (WhatsApp Cloud API, Anthropic, Prisma). No hay un modo "local sin credenciales" para el webhook completo: cualquier POST con un mensaje dispara la IA (Anthropic) y el envío por WhatsApp. Para probar la lógica sin credenciales, usa el Nivel 1.

---

## Nivel 1 — Suite automatizada (recomendado siempre)

Requisitos: Node ≥ 20.

```bash
cd ali-club-bot
npm install          # solo la primera vez
npm test             # corre toda la suite (Vitest)
npx tsc --noEmit     # chequeo de tipos
```

Debe salir **verde** (a la fecha: 18 archivos, 65 tests) y `tsc` sin errores.

Qué cubre:
- **Config:** menú (precios enteros COP), zonas (match sin acentos/mayúsculas), horario.
- **Dominio:** cálculo de subtotal/total, máquina de estados (transiciones legales/ilegales).
- **Repositorio:** creación, `attachProof` atómico, `transition` con anti doble-aprobación.
- **OrderService:** confirmar (transferencia→`awaiting_payment`, efectivo→`pending_review`), aprobar/rechazar, doble-review lanza error.
- **Herramientas del agente:** menú, validación de zona, add/remove, datos del cliente, confirmar, QR; y que **no existe** ninguna herramienta de aprobación.
- **Webhook:** parseo de payloads (texto/imagen/basura), y el **Guard de firma HMAC**.
- **E2E (con fakes):** flujo transferencia y flujo efectivo de punta a punta a través del `WebhookController` real.

Comandos útiles:
```bash
npm run test:watch                         # modo watch
npx vitest run src/e2e.test.ts             # solo el E2E con fakes
npx vitest run src/agent/orchestrator.test.ts
```

---

## Nivel 2 — E2E real con WhatsApp Cloud API

### 2.0 Checklist de prerrequisitos (una sola vez)

- [ ] **Cuenta Meta Business** + una **app** con el producto **WhatsApp** agregado.
- [ ] **Número de prueba** de WhatsApp Cloud API (Meta da uno gratis) o número propio verificado.
- [ ] Del panel de Meta: **`WHATSAPP_TOKEN`** (temporal de 24h o permanente vía System User), **`WHATSAPP_PHONE_NUMBER_ID`**, y el **App Secret** (`WHATSAPP_APP_SECRET`, en App Settings → Basic).
- [ ] Inventas tú el **`WHATSAPP_VERIFY_TOKEN`** (cualquier string; lo repites en Meta al registrar el webhook).
- [ ] **`ANTHROPIC_API_KEY`** (console.anthropic.com).
- [ ] **`STAFF_CHAT_ID`**: el número (formato internacional sin `+`, p.ej. `573001112233`) del WhatsApp del staff que aprobará. Debe poder escribirle al número del bot.
- [ ] Imagen **QR de pago** en `assets/payment-qr.png` (o ajusta `QR_IMAGE_PATH`).
- [ ] **Postgres** corriendo.
- [ ] Un **túnel** para exponer tu localhost (ngrok o cloudflared).

> Durante pruebas, WhatsApp solo entrega mensajes a/desde números que agregaste como **destinatarios de prueba** en el panel de Meta. Agrega tu celular personal y el del staff ahí.

### 2.1 Configurar `.env`

```bash
cp .env.example .env
```
Edita `.env` con tus valores reales:
```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ali_club_bot
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_VERIFY_TOKEN=mi-token-secreto
WHATSAPP_APP_SECRET=<App Secret de Meta>
STAFF_CHAT_ID=573001112233
PROOF_DIR=./data/proofs
QR_IMAGE_PATH=./assets/payment-qr.png
PORT=3000
```

### 2.2 Base de datos

Con Docker (lo más rápido):
```bash
docker run --name ali-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ali_club_bot -p 5432:5432 -d postgres:16
```
Crea las tablas:
```bash
npx prisma migrate dev --name init
```
(Inspección opcional: `npx prisma studio`.)

### 2.3 Levantar el servidor + túnel

En una terminal:
```bash
npm run start:dev        # NestJS en http://localhost:3000
```
En otra, expón el puerto (elige una):
```bash
cloudflared tunnel --url http://localhost:3000
# o
ngrok http 3000
```
Copia la URL pública `https://XXXX...` (tu **callback URL** será `https://XXXX.../webhook`).

Smoke test rápido (no gasta WhatsApp):
```bash
curl http://localhost:3000/health          # → {"ok":true}
```

### 2.4 Registrar el webhook en Meta

En el panel de la app → **WhatsApp → Configuration → Webhook**:
- **Callback URL:** `https://XXXX.../webhook`
- **Verify token:** el mismo `WHATSAPP_VERIFY_TOKEN` de tu `.env`
- Click **Verify and save** → Meta hace un GET; tu server responde el `challenge`. Si no valida, revisa que el token coincida y que el túnel esté arriba.
- **Subscribe** al campo **`messages`**.

### 2.5 Escenarios de prueba (guion paso a paso)

Escribe desde tu celular de prueba al número del bot.

**A) Transferencia (happy path)**
1. Escribe: `hola` → el bot saluda y ofrece el menú.
2. Pide algo: `quiero 12 alitas y una gaseosa`.
3. Da datos: `soy Ana, Cra 70 # 1-2, barrio Laureles`.
4. Confirma cuando el bot resuma, y elige **transferencia**.
5. El bot envía el **QR** (imagen) y pide el comprobante.
6. Envía una **foto** cualquiera como comprobante.
7. El bot responde que queda **en revisión**.
   - ✔️ Verifica en la DB que el pedido está en `pending_review` con `proofImagePath` (ver 2.6).
   - ✔️ El **chat del staff** (`STAFF_CHAT_ID`) recibe el resumen + la imagen del comprobante.

**B) Efectivo**
- Igual que A pero elige **efectivo contra entrega**. No se envía QR; el pedido va directo a `pending_review` y el staff recibe el aviso.

**C) Aprobar / rechazar (desde el chat del staff)**
- Desde el número `STAFF_CHAT_ID`, escribe al bot: `aprobar #1`
  - ✔️ El cliente recibe "…en preparación…"; el pedido queda `approved`.
- O `rechazar #1 pago no recibido`
  - ✔️ El cliente recibe el rechazo con el motivo; el pedido queda `rejected`.
- Doble aprobación: manda `aprobar #1` dos veces → la segunda no cambia nada (protección anti doble-aprobación); revisa el log del server.

**D) Barrio sin cobertura**
- En el paso de datos usa un barrio no cubierto (p.ej. `barrio Narnia`) → el bot se disculpa y no toma el domicilio. (Barrios cubiertos por defecto: laureles, belén, estadio, poblado — están en `src/config/zones.ts`.)

**E) Fuera de horario**
- Horario por defecto: 12:00–22:00 (`src/config/businessHours.ts`). Fuera de esa franja, el bot informa el horario y no toma pedidos.
- Para probarlo sin esperar: cambia temporalmente `OPEN_HOUR`/`CLOSE_HOUR` en `businessHours.ts` y reinicia.

### 2.6 Qué verificar (DB y logs)

Estados esperados: `building → awaiting_payment → pending_review → approved | rejected` (efectivo salta `awaiting_payment`).

```bash
npx prisma studio       # UI para ver la tabla Order
```
o por SQL:
```bash
docker exec -it ali-pg psql -U postgres -d ali_club_bot \
  -c "select id,status,paymentMethod,\"totalCop\",\"proofImagePath\" from \"Order\" order by \"createdAt\" desc;"
```
- Comprobantes guardados en `./data/proofs/<orderId>.<ext>`.
- Errores de procesamiento se **loguean** (no se tragan en silencio) en la salida de `npm run start:dev`.

---

## Apéndice — Probar el webhook con `curl` (firma HMAC)

El POST `/webhook` exige la firma `X-Hub-Signature-256` de Meta. Para simularlo local, firma el body con tu `WHATSAPP_APP_SECRET`.

**GET (handshake de verificación)** — no requiere firma:
```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=$WHATSAPP_VERIFY_TOKEN&hub.challenge=test123"
# → test123
```

**POST firmado** (dispara la IA y el envío por WhatsApp, así que necesitas creds reales):
```bash
SECRET='<tu WHATSAPP_APP_SECRET>'
BODY='{"entry":[{"changes":[{"value":{"messages":[{"from":"573001112233","id":"m1","type":"text","text":{"body":"hola"}}]}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIG" \
  --data "$BODY"
# firma inválida o ausente → 403
```

> El body debe enviarse **exactamente** como se firmó (mismos bytes). Si cambias un espacio, la firma no coincide.

---

## Solución de problemas

- **El webhook no valida en Meta:** túnel caído, o `WHATSAPP_VERIFY_TOKEN` distinto entre Meta y `.env`.
- **POST responde 403:** falta/incorrecta la firma; verifica `WHATSAPP_APP_SECRET`.
- **El bot no responde:** revisa `ANTHROPIC_API_KEY` y el log del server; y que tu número esté en la lista de destinatarios de prueba de Meta.
- **No llega nada al staff:** `STAFF_CHAT_ID` mal formateado (usa internacional sin `+`) o ese número no está entre los destinatarios de prueba.
- **Falla `prisma migrate`:** Postgres no está arriba o `DATABASE_URL` incorrecta.
- **El QR no se envía:** falta `assets/payment-qr.png` o `QR_IMAGE_PATH` mal.

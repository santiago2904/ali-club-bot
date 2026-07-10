# Guía de prerrequisitos — ali-club-bot

Todo lo que hay que tener listo **antes** de probar el bot en real (Nivel 2 de la
[guía de pruebas](./TESTING-GUIDE.md)). Ninguno es código: son cuentas, credenciales
y datos del negocio.

## Mapa rápido: prerrequisito → variable de `.env`

| # | Prerrequisito | Variable(s) en `.env` |
|---|---|---|
| 1 | App de Meta + WhatsApp Cloud API | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` |
| 2 | Verify token (lo inventas tú) | `WHATSAPP_VERIFY_TOKEN` |
| 3 | Números de prueba (destinatarios) | — (se configuran en Meta) |
| 4 | API key de Anthropic | `ANTHROPIC_API_KEY` |
| 5 | PostgreSQL | `DATABASE_URL` |
| 6 | Número del staff | `STAFF_CHAT_ID` |
| 7 | QR de pago (imagen) | `QR_IMAGE_PATH` (+ archivo en `assets/`) |
| 8 | Datos reales del negocio | — (archivos en `src/config/`) |

Al final: `cp .env.example .env` y llenas todo.

---

## 1. App de Meta + WhatsApp Cloud API

Es el prerrequisito más grande. Hoy el negocio solo tiene la **app** de WhatsApp
Business; necesitamos la **Cloud API** (oficial, por webhooks).

### 1.1 Cuenta y app
1. Entra a **https://developers.facebook.com** con una cuenta de Facebook.
2. **My Apps → Create App** → tipo **Business** → nombre (ej. "Ali Club Bot").
3. En el dashboard de la app, **Add Product → WhatsApp → Set up**.
   - Esto crea/asocia una **Meta Business Account** y te da un **número de prueba** gratis del lado de Meta (el número desde el que responde el bot en pruebas).

### 1.2 Valores que necesitas (de "WhatsApp → API Setup")
- **`WHATSAPP_PHONE_NUMBER_ID`**: el *Phone number ID* del número de prueba (no el número en sí, es un ID numérico).
- **`WHATSAPP_TOKEN`**: el **temporary access token** (dura 24h) — sirve para empezar a probar hoy mismo. Para algo estable, ver 1.4.

### 1.3 App Secret → `WHATSAPP_APP_SECRET`
- **App Settings → Basic → App Secret → Show.**
- Con esto el bot verifica que los webhooks vienen de Meta (firma HMAC). Es obligatorio: sin él, el POST del webhook responde 403.

### 1.4 Token permanente (para que no expire cada 24h)
El token temporal muere en 24h. Para uno permanente:
1. **business.facebook.com → Business Settings → Users → System Users → Add** (crea un system user, rol Admin).
2. **Assign assets** → asigna tu **app** al system user (con control total).
3. **Generate new token** → elige la app → permisos **`whatsapp_business_messaging`** y **`whatsapp_business_management`** → genera.
4. Ese token va en `WHATSAPP_TOKEN`. (Guárdalo bien; no se vuelve a mostrar.)

> **Para pruebas puedes saltarte 1.4** y usar el token temporal de 24h. El permanente es para dejarlo corriendo.

### 1.5 Salir de "modo prueba" (solo cuando vayas a producción real)
Para escribirle a **cualquier** cliente (no solo números de prueba) necesitarás:
número de teléfono propio verificado, **verificación del negocio** (Business
Verification), y aprobación del **display name**. Para todas las pruebas del MVP,
el número de prueba + destinatarios de prueba (paso 3) son suficientes.

---

## 2. Verify token → `WHATSAPP_VERIFY_TOKEN`

Lo **inventas tú**: cualquier string secreto (ej. `ali-club-2026-xyz`). Debe ser el
mismo que pongas en Meta al registrar el webhook (paso de la guía de pruebas 2.4).
Solo se usa en el handshake de verificación (GET).

---

## 3. Números de prueba (destinatarios)

En modo desarrollo Meta solo entrega a números que agregues (hasta 5).
**No aplica agregar grupos: la Cloud API no soporta grupos**, solo números
individuales.

1. **WhatsApp → API Setup** → sección del destinatario ("To") → **Manage phone number list / Add recipient**.
2. Agrega, en formato internacional, tu **celular de prueba** y el del **staff**.
3. Cada número recibe un código por WhatsApp → confírmalo.

---

## 4. API key de Anthropic → `ANTHROPIC_API_KEY`

1. **https://console.anthropic.com** → crea cuenta / inicia sesión.
2. **Settings → API Keys → Create Key** → cópiala (empieza con `sk-ant-`).
3. Agrega saldo en **Billing** (el bot paga por tokens usados; el modelo es `claude-sonnet-5`).

---

## 5. PostgreSQL → `DATABASE_URL`

Opción rápida con Docker:
```bash
docker run --name ali-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ali_club_bot -p 5432:5432 -d postgres:16
```
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ali_club_bot`

Luego crea las tablas:
```bash
npx prisma migrate dev --name init
```
(En producción: un Postgres gestionado — RDS, Neon, Supabase, Railway — y pones su `DATABASE_URL`.)

---

## 6. Número del staff → `STAFF_CHAT_ID`

- El número **individual** del staff que aprobará pedidos, en formato internacional **sin `+`** (ej. `573001112233`).
- Debe estar en la lista de destinatarios de prueba (paso 3).
- Recibe los pedidos y responde `aprobar #N` / `rechazar #N`.
- ¿Varias personas? La Cloud API no tiene grupos: usa un **número compartido**, o pide el **fan-out a varios números** (cambio pequeño de código), o espera el **panel web** (Fase 2).

---

## 7. QR de pago → `QR_IMAGE_PATH` (+ archivo)

1. Abre la app del banco/billetera del negocio (Nequi, Bancolombia, Daviplata, etc.).
2. Genera/exporta el **QR de "recibir pago"** como imagen (PNG).
3. Guárdala como **`assets/payment-qr.png`** en el repo (crea la carpeta `assets/` si no existe).
   - Si usas otra ruta/nombre, ajusta `QR_IMAGE_PATH` en `.env`.
4. El bot envía esta imagen tal cual cuando el cliente elige transferencia.

---

## 8. Datos reales del negocio (archivos de config)

El código trae valores **placeholder**. Reemplázalos con lo real antes de lanzar:

- **Menú y precios** → `src/config/menu.ts`
  Edita el arreglo `MENU`: `id` (interno), `name` (lo ve el cliente), `priceCop` (entero, sin decimales). Ej: `{ id: "wings_10", name: "10 alitas BBQ", priceCop: 28000 }`.
- **Zonas de cobertura y domicilio** → `src/config/zones.ts`
  Edita `ZONES`: `key` en minúscula y **sin tildes** (ej. `"belen"`), `deliveryFeeCop` (entero). El bot normaliza tildes/mayúsculas al comparar.
- **Horario** → `src/config/businessHours.ts`
  Ajusta `OPEN_HOUR`/`CLOSE_HOUR` (0–23) y el texto `hoursText()`.

> Estos son cambios de código triviales (datos, no lógica). Si prefieres, te los actualizo cuando me pases el menú/zonas/horario reales.

---

## Checklist final

- [ ] 1. App de Meta creada, WhatsApp agregado → tengo `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`
- [ ] 2. `WHATSAPP_VERIFY_TOKEN` inventado
- [ ] 3. Mi celular y el del staff agregados como destinatarios de prueba
- [ ] 4. `ANTHROPIC_API_KEY` con saldo
- [ ] 5. Postgres corriendo + `prisma migrate dev` ejecutado
- [ ] 6. `STAFF_CHAT_ID` (número individual, internacional sin `+`)
- [ ] 7. `assets/payment-qr.png` en su lugar
- [ ] 8. Menú, zonas y horario reales en `src/config/`
- [ ] `.env` completo (`cp .env.example .env` y lleno todo)

Con esto listo, sigue la [guía de pruebas](./TESTING-GUIDE.md) → Nivel 2.

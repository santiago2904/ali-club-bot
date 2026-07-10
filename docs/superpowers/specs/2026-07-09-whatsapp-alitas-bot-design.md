# Diseño — Bot de WhatsApp para pedidos de alitas BBQ

**Fecha:** 2026-07-09
**Estado:** Aprobado (diseño), pendiente de plan de implementación

## Problema

Un negocio de alitas BBQ tiene represamiento al tomar domicilios en hora pico
(atención manual por WhatsApp). Se quiere un asistente con IA que responda los
mensajes y conduzca todo el flujo de pedido: mostrar el menú, capturar los datos
del cliente y la dirección, armar el pedido, gestionar el pago y dejar la
transferencia pendiente de verificación humana.

## Convenciones

- **Código, identificadores, nombres, comentarios y tipos → en inglés** (estándar).
- **Textos de cara al cliente y prompts de la IA → en español (Colombia)**, tono cercano.
- Cliente en Colombia.

## Decisiones clave (cerradas)

| Tema | Decisión |
|---|---|
| Canal de WhatsApp | **WhatsApp Cloud API oficial** de Meta. Prerrequisito no-code: crear cuenta Meta Business + verificar un número (hoy solo tienen la app de WhatsApp Business). |
| Enfoque de la conversación | **Agente IA con herramientas (function calling)** usando Claude. Las herramientas son la única fuente de verdad (precios, zonas, estados). |
| Implementación | **Código propio en Node.js + TypeScript con NestJS + Express** (una sola base que crece hasta el panel web). |
| Menú | **Simple**: porciones de alitas, papas, bebidas, con precios fijos. |
| Cobertura de domicilios | **Validación por barrio/zona**, con costo de domicilio por zona. |
| Métodos de pago | **Transferencia (QR fijo + comprobante)** y **efectivo contra entrega**. |
| Pago por transferencia | QR fijo (misma cuenta), el cliente sube foto del comprobante → estado `pending_review`. La IA nunca confirma un pago; solo un humano lo aprueba. |
| Control humano | **MVP:** reenvío del pedido + comprobante a un chat/grupo interno de WhatsApp, con comandos `aprobar`/`rechazar`. **Fase 2:** panel web propio (misma lógica de estados, distinto canal de aprobación). |

## Arquitectura

**Stack:** Node.js + TypeScript, **NestJS + Express** para el servidor/webhook (con
su inyección de dependencias), Anthropic API (Claude) como cerebro, PostgreSQL para
pedidos, y almacenamiento local de imágenes de comprobantes (detrás de una interfaz).

**Componentes:**

1. **Webhook receiver** — recibe mensajes entrantes (texto e imágenes) y envía
   respuestas vía Cloud API.
2. **Conversation orchestrator** — mantiene la sesión por cliente (historial +
   borrador de pedido) y llama a Claude con las herramientas.
3. **Catalog** (config) — productos y precios.
4. **Delivery zones** (config) — barrio → `{ covered, deliveryFee }`.
5. **Order store** — pedido con máquina de estados.
6. **Payments** — envía el QR fijo, recibe comprobante, lo guarda, pasa a
   `pending_review`.
7. **Human control** — MVP: reenvío a chat interno; staff responde
   `aprobar`/`rechazar`. Fase 2: panel web.

**Flujo:** mensaje entra → webhook → carga sesión → Claude (con herramientas) →
ejecuta herramientas → responde. Al recibir comprobante → `pending_review` →
notifica al staff → staff aprueba/rechaza → notifica al cliente.

## Modelo de datos y estados

**ConversationSession** (una por número de cliente):
`phone`, `history` (mensajes recientes), `orderDraft`, `updatedAt`.
Expira tras inactividad (~30 min).

**Order:**
- `id`, `customerPhone`, `customerName`
- `items[]` → `{ productId, name, quantity, unitPrice }`
- `deliveryAddress`, `zone`, `deliveryFee`
- `subtotal`, `total`
- `paymentMethod` → `transfer` | `cash`
- `proofImageUrl` (comprobante), `status`, `createdAt`, `reviewedBy`, `reviewedAt`

**Estados del pedido:**
`building` → `awaiting_payment` → `pending_review` → `approved` | `rejected`

- **Transferencia:** pasa por `awaiting_payment` (QR enviado) hasta recibir
  comprobante → `pending_review`.
- **Efectivo:** salta `awaiting_payment` y va directo a `pending_review` para
  que el staff confirme antes de despachar.

**Config (archivos versionados):**
- `menu.ts` — productos, precios.
- `zones.ts` — barrio → `{ covered, deliveryFee }`.
- `businessHours.ts` — horas de atención; fuera de horario el bot informa y no
  toma pedidos.

## Herramientas de la IA (function calling)

Claude conduce la conversación libremente y solo puede actuar mediante estas
herramientas (nombres en inglés; devuelven la única fuente de verdad):

1. `get_menu()` → catálogo y precios.
2. `validate_zone(neighborhood)` → cobertura + costo de domicilio.
3. `add_item(productId, quantity)` / `remove_item(...)`.
4. `set_customer_details(name, address, neighborhood)`.
5. `summarize_order()` → totales para confirmar con el cliente.
6. `confirm_order(paymentMethod)` → crea `Order`; pasa a `awaiting_payment`
   (transferencia) o `pending_review` (efectivo).
7. `send_qr()` → envía imagen del QR fijo + instrucciones.
8. `register_payment_proof(image)` → guarda comprobante, pasa a `pending_review`,
   notifica al staff.

**Regla dura del system prompt:** nunca inventar precios, productos ni cobertura;
solo lo que devuelven las herramientas. Sin cobertura → se disculpa y cierra
amablemente. La IA nunca confirma un pago.

## Pago y control humano

**Pago:**
- **Transferencia:** el bot envía el QR fijo + instrucciones; el cliente sube foto
  del comprobante → `pending_review`.
- **Efectivo:** sin comprobante; pasa directo a `pending_review` para confirmación
  del staff.

**Control humano (MVP — chat interno de WhatsApp):**
- Al entrar un pedido a `pending_review`, el bot reenvía al chat/grupo interno:
  resumen del pedido, total, dirección, método de pago y (si aplica) imagen del
  comprobante.
- El staff responde con un comando simple referenciando el pedido:
  `aprobar #123` / `rechazar #123 <motivo>`.
- El bot notifica al cliente: aprobado → en preparación / tiempo estimado;
  rechazado → motivo.

**Fase 2 (panel web):** misma máquina de estados; la aprobación se hace desde una
UI con lista de pedidos y visor de comprobante. Solo cambia el canal de aprobación.

## Manejo de errores y bordes

- Fuera de horario → informa horario, no toma pedido.
- Barrio sin cobertura → se disculpa y cierra.
- Imagen que no parece comprobante → pide reenviar.
- Cliente edita el pedido → `add_item`/`remove_item` lo permiten.
- Fallo de WhatsApp API o de Claude → reintento con backoff + log; si persiste,
  mensaje de "estamos con problemas, te contactamos".
- Mensajes duplicados del webhook → idempotencia por `message id`.
- La IA nunca confirma un pago; solo un humano lo aprueba.

## Pruebas

- **Unitarias:** cálculo de totales, validación de zona, transiciones de estado.
- **De conversación:** simular secuencias de mensajes contra el orquestador con
  WhatsApp y Claude mockeados (verificar herramientas correctas y cambios de estado).
- **E2E manual:** número de prueba de WhatsApp; recorrer pedido completo
  (transferencia y efectivo, con y sin cobertura).

## Prerrequisitos (fuera de código)

1. Crear cuenta de Meta Business para el negocio.
2. Verificar un número para la WhatsApp Cloud API y obtener credenciales
   (token, phone number id, verify token del webhook).
3. Definir cuenta destino y generar el QR fijo (imagen).
4. Definir barrios cubiertos y costos de domicilio.
5. Definir horario de atención.
6. Definir chat/grupo interno de WhatsApp para el control humano (MVP).

## Fuera de alcance (por ahora)

- Panel web propio (Fase 2).
- QR dinámico por pedido / pasarela de pagos.
- Menú con variantes complejas, promociones por día, half-and-half.
- Integración con sistemas de cocina/POS.

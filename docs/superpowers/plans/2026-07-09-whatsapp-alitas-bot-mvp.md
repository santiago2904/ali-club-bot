# WhatsApp Alitas BBQ Order Bot — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a WhatsApp bot that takes BBQ-wings delivery orders end-to-end (menu → customer data → order → payment), leaving transfers as `pending_review` for human approval, and routing orders to an internal staff WhatsApp chat for the MVP.

**Architecture:** A NestJS + Express app exposes a webhook controller that receives WhatsApp Cloud API messages. A conversation orchestrator loads a per-customer session and drives Claude with tool-calling; tools are the single source of truth for menu, zones, pricing and order state. Confirmed orders persist to Postgres (via Prisma behind an `OrderRepository` interface). Payment proofs save to local disk behind a `ProofStorage` interface. Orders in `pending_review` are forwarded to an internal staff chat where `aprobar`/`rechazar` commands transition them. All external dependencies (DB, storage, WhatsApp, LLM, session store) sit behind interfaces bound to NestJS injection tokens, with in-memory/scripted fakes so every unit is testable without live services.

**Tech Stack:** Node.js ≥ 20, TypeScript 5, NestJS 11 + `@nestjs/platform-express`, Prisma 6 + PostgreSQL, `@anthropic-ai/sdk` (Claude), Vitest 2 (+ `unplugin-swc` for decorators), `zod` for env/payload validation.

## Global Constraints

- Node.js **≥ 20**; TypeScript **^5.4**; **CommonJS** modules (NestJS standard — no `"type": "module"`, imports carry **no** `.js` extension).
- `tsconfig` MUST enable `experimentalDecorators` and `emitDecoratorMetadata`; `main.ts` imports `reflect-metadata` first.
- Code, identifiers, types, comments → **English**. Customer-facing text and the LLM system prompt → **Spanish (Colombia)**, warm tone.
- Money is **Colombian pesos (COP) as integers** — no decimals, no floats. All money fields/vars suffixed `Cop`.
- LLM model: **`claude-sonnet-5`**. Never let the model invent prices, products, or coverage — tools return the only source of truth.
- The bot **never confirms a payment**; only a human transitions `pending_review → approved`.
- Neighborhood matching is **accent- and case-insensitive** (normalize before compare).
- External deps (DB, storage, WhatsApp, LLM, session store) are always accessed through an interface bound to a **NestJS injection token**; production impls are provided in `AppModule`, unit tests instantiate classes directly with fakes.
- **Unit tests use direct instantiation** (`new Service(fake)`), never the Nest DI container, so no reflection is required at test time. `@Injectable()`/`@Inject()` decorators do not affect manual construction.
- No Prisma types leak into domain/agent code — everything flows through the `OrderRepository` interface and the domain `Order` type.

---

## File Structure

```
ali-club-bot/
├── package.json
├── tsconfig.json
├── nest-cli.json
├── vitest.config.ts
├── .env.example
├── prisma/
│   └── schema.prisma
├── src/
│   ├── config/
│   │   ├── env.ts            # validated environment variables (zod)
│   │   ├── menu.ts           # product catalog + prices
│   │   ├── zones.ts          # neighborhood coverage + delivery fees
│   │   └── businessHours.ts  # operating hours, isOpen(), hoursText()
│   ├── domain/
│   │   └── order.ts          # Order/OrderItem/OrderDraft types, pricing, state machine
│   ├── storage/
│   │   ├── proofStorage.ts   # ProofStorage interface + PROOF_STORAGE token
│   │   ├── localProofStorage.ts
│   │   └── memoryProofStorage.ts   # test fake
│   ├── orders/
│   │   ├── orderRepository.ts      # OrderRepository interface + ORDER_REPOSITORY token
│   │   ├── prismaOrderRepository.ts
│   │   ├── memoryOrderRepository.ts   # test fake
│   │   └── orderService.ts         # @Injectable; create/transition orders
│   ├── sessions/
│   │   └── sessionStore.ts   # SESSION_STORE token, Session/OrderDraft, MemorySessionStore
│   ├── whatsapp/
│   │   ├── client.ts         # WhatsAppClient interface + WHATSAPP_CLIENT token + fake
│   │   ├── cloudApiClient.ts # real Cloud API impl
│   │   └── webhook.ts        # parse inbound webhook payload → InboundMessage
│   ├── agent/
│   │   ├── tools.ts          # tool schemas + runTool()
│   │   ├── prompt.ts         # Spanish system prompt
│   │   ├── llmClient.ts      # LlmClient interface + LLM_CLIENT token
│   │   ├── anthropicLlmClient.ts
│   │   └── orchestrator.ts   # @Injectable; conversation loop
│   ├── staff/
│   │   └── control.ts        # @Injectable; parse aprobar/rechazar, notify staff
│   ├── bot/
│   │   ├── botConfig.ts      # BOT_CONFIG token + BotConfig type
│   │   └── webhook.controller.ts  # GET/POST /webhook, GET /health
│   ├── app.module.ts         # NestJS module wiring all providers
│   └── main.ts               # bootstrap (reflect-metadata + NestFactory)
└── tests/                    # colocated *.test.ts also allowed
```

---

## Task 1: Project scaffolding (NestJS + Express)

**Files:**
- Create: `package.json`, `tsconfig.json`, `nest-cli.json`, `vitest.config.ts`, `.env.example`, `src/config/env.ts`
- Test: `src/config/env.test.ts`

**Interfaces:**
- Produces: `type Env` and `loadEnv(raw: Record<string,string|undefined>): Env` with keys `ANTHROPIC_API_KEY`, `DATABASE_URL`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `STAFF_CHAT_ID`, `PROOF_DIR`, `QR_IMAGE_PATH`, `PORT`; plus `const env: Env`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ali-club-bot",
  "version": "0.1.0",
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@prisma/client": "^6.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@swc/core": "^1.7.0",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "prisma": "^6.0.0",
    "typescript": "^5.4.0",
    "unplugin-swc": "^1.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (NestJS standard — CommonJS + decorators)

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "target": "ES2021",
    "moduleResolution": "node",
    "outDir": "./dist",
    "baseUrl": "./",
    "rootDir": "./src",
    "sourceMap": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}
```

- [ ] **Step 4: Create `vitest.config.ts`** (swc plugin so decorators/metadata transform correctly)

```ts
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
  plugins: [swc.vite()],
});
```

- [ ] **Step 5: Create `.env.example`**

```
ANTHROPIC_API_KEY=sk-ant-xxx
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ali_club_bot
WHATSAPP_TOKEN=EAAxxx
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_VERIFY_TOKEN=my-verify-token
STAFF_CHAT_ID=573001112233
PROOF_DIR=./data/proofs
QR_IMAGE_PATH=./assets/payment-qr.png
PORT=3000
```

- [ ] **Step 6: Write the failing test** — `src/config/env.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { loadEnv } from "./env";

const full = {
  ANTHROPIC_API_KEY: "k", DATABASE_URL: "d", WHATSAPP_TOKEN: "t",
  WHATSAPP_PHONE_NUMBER_ID: "p", WHATSAPP_VERIFY_TOKEN: "v",
  STAFF_CHAT_ID: "s", PROOF_DIR: "./data/proofs",
  QR_IMAGE_PATH: "./assets/payment-qr.png", PORT: "3000",
};

describe("loadEnv", () => {
  it("parses a full environment", () => {
    const env = loadEnv(full);
    expect(env.PORT).toBe(3000);
    expect(env.ANTHROPIC_API_KEY).toBe("k");
  });

  it("throws when a required var is missing", () => {
    const { ANTHROPIC_API_KEY, ...partial } = full;
    expect(() => loadEnv(partial)).toThrow();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/config/env.test.ts`
Expected: FAIL — cannot find module `./env`.

- [ ] **Step 8: Write `src/config/env.ts`**

```ts
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
});

export type Env = z.infer<typeof schema>;

export function loadEnv(raw: Record<string, string | undefined>): Env {
  return schema.parse(raw);
}

export const env: Env = loadEnv(process.env);
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/config/env.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json nest-cli.json vitest.config.ts .env.example src/config/env.ts src/config/env.test.ts
git commit -m "chore: scaffold NestJS project and env config"
```

---

## Task 2: Catalog, zones, and business hours config

**Files:**
- Create: `src/config/menu.ts`, `src/config/zones.ts`, `src/config/businessHours.ts`
- Test: `src/config/menu.test.ts`, `src/config/zones.test.ts`, `src/config/businessHours.test.ts`

**Interfaces:**
- Produces:
  - `interface Product { id: string; name: string; priceCop: number }`
  - `getMenu(): Product[]`, `findProduct(id: string): Product | undefined`
  - `interface ZoneResult { covered: boolean; deliveryFeeCop: number; neighborhood: string }`
  - `normalizeNeighborhood(value: string): string`, `validateZone(neighborhood: string): ZoneResult`
  - `isOpen(date: Date): boolean`, `hoursText(): string`

- [ ] **Step 1: Write failing test** — `src/config/menu.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { getMenu, findProduct } from "./menu";

describe("menu", () => {
  it("returns products with positive integer COP prices", () => {
    const menu = getMenu();
    expect(menu.length).toBeGreaterThan(0);
    for (const p of menu) {
      expect(Number.isInteger(p.priceCop)).toBe(true);
      expect(p.priceCop).toBeGreaterThan(0);
    }
  });

  it("finds a product by id and returns undefined for unknown", () => {
    const first = getMenu()[0];
    expect(findProduct(first.id)?.id).toBe(first.id);
    expect(findProduct("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/menu.test.ts`
Expected: FAIL — cannot find module `./menu`.

- [ ] **Step 3: Write `src/config/menu.ts`**

```ts
export interface Product {
  id: string;
  name: string;
  priceCop: number;
}

// Placeholder catalog — confirm real names/prices with the business before launch.
const MENU: Product[] = [
  { id: "wings_6", name: "6 alitas BBQ", priceCop: 18000 },
  { id: "wings_12", name: "12 alitas BBQ", priceCop: 32000 },
  { id: "wings_24", name: "24 alitas BBQ", priceCop: 60000 },
  { id: "fries", name: "Papas a la francesa", priceCop: 9000 },
  { id: "soda", name: "Gaseosa personal", priceCop: 4000 },
];

export function getMenu(): Product[] {
  return MENU;
}

export function findProduct(id: string): Product | undefined {
  return MENU.find((p) => p.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/menu.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test** — `src/config/zones.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateZone } from "./zones";

describe("validateZone", () => {
  it("matches a covered neighborhood ignoring case and whitespace", () => {
    const r = validateZone("  LAURELES ");
    expect(r.covered).toBe(true);
    expect(r.deliveryFeeCop).toBeGreaterThanOrEqual(0);
  });

  it("normalizes accents", () => {
    expect(validateZone("belén").covered).toBe(validateZone("belen").covered);
  });

  it("returns not covered for unknown neighborhood", () => {
    expect(validateZone("narnia").covered).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/config/zones.test.ts`
Expected: FAIL — cannot find module `./zones`.

- [ ] **Step 7: Write `src/config/zones.ts`**

```ts
export interface ZoneResult {
  covered: boolean;
  deliveryFeeCop: number;
  neighborhood: string;
}

interface ZoneEntry {
  key: string; // normalized
  deliveryFeeCop: number;
}

// Placeholder coverage — confirm real neighborhoods/fees with the business.
const ZONES: ZoneEntry[] = [
  { key: "laureles", deliveryFeeCop: 5000 },
  { key: "belen", deliveryFeeCop: 6000 },
  { key: "estadio", deliveryFeeCop: 5000 },
  { key: "poblado", deliveryFeeCop: 8000 },
];

export function normalizeNeighborhood(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function validateZone(neighborhood: string): ZoneResult {
  const key = normalizeNeighborhood(neighborhood);
  const match = ZONES.find((z) => z.key === key);
  return {
    covered: Boolean(match),
    deliveryFeeCop: match?.deliveryFeeCop ?? 0,
    neighborhood: key,
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/config/zones.test.ts`
Expected: PASS.

- [ ] **Step 9: Write failing test** — `src/config/businessHours.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { isOpen, hoursText } from "./businessHours";

describe("businessHours", () => {
  it("is open at 19:00 and closed at 04:00", () => {
    const open = new Date(2026, 6, 9, 19, 0);
    const closed = new Date(2026, 6, 9, 4, 0);
    expect(isOpen(open)).toBe(true);
    expect(isOpen(closed)).toBe(false);
  });

  it("exposes a Spanish hours description", () => {
    expect(hoursText()).toMatch(/\d/);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run src/config/businessHours.test.ts`
Expected: FAIL — cannot find module `./businessHours`.

- [ ] **Step 11: Write `src/config/businessHours.ts`**

```ts
// Operating hours: every day 12:00–22:00 local time.
// Confirm real hours with the business before launch.
const OPEN_HOUR = 12;
const CLOSE_HOUR = 22;

export function isOpen(date: Date): boolean {
  const hour = date.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

export function hoursText(): string {
  return "Atendemos todos los días de 12:00 p.m. a 10:00 p.m.";
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run src/config/`
Expected: PASS (all config tests).

- [ ] **Step 13: Commit**

```bash
git add src/config/menu.ts src/config/menu.test.ts src/config/zones.ts src/config/zones.test.ts src/config/businessHours.ts src/config/businessHours.test.ts
git commit -m "feat: add catalog, delivery zones, and business hours config"
```

---

## Task 3: Order domain — types, pricing, state machine

**Files:**
- Create: `src/domain/order.ts`
- Test: `src/domain/order.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PaymentMethod = "transfer" | "cash"`
  - `type OrderStatus = "building" | "awaiting_payment" | "pending_review" | "approved" | "rejected"`
  - `interface OrderItem { productId: string; name: string; quantity: number; unitPriceCop: number }`
  - `interface OrderDraft { items: OrderItem[]; customerName?: string; deliveryAddress?: string; zone?: string; deliveryFeeCop: number }`
  - `interface Order { id: string; customerPhone: string; customerName: string; items: OrderItem[]; deliveryAddress: string; zone: string; deliveryFeeCop: number; subtotalCop: number; totalCop: number; paymentMethod: PaymentMethod; proofImagePath: string | null; status: OrderStatus; createdAt: Date; reviewedBy: string | null; reviewedAt: Date | null }`
  - `calcSubtotalCop(items: OrderItem[]): number`
  - `calcTotalCop(subtotalCop: number, deliveryFeeCop: number): number`
  - `emptyDraft(): OrderDraft`
  - `canTransition(from: OrderStatus, to: OrderStatus): boolean`

- [ ] **Step 1: Write failing test** — `src/domain/order.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  calcSubtotalCop, calcTotalCop, emptyDraft, canTransition, OrderItem,
} from "./order";

const items: OrderItem[] = [
  { productId: "wings_12", name: "12 alitas BBQ", quantity: 2, unitPriceCop: 32000 },
  { productId: "soda", name: "Gaseosa personal", quantity: 1, unitPriceCop: 4000 },
];

describe("order pricing", () => {
  it("sums quantity * unitPrice", () => {
    expect(calcSubtotalCop(items)).toBe(68000);
  });
  it("adds delivery fee to total", () => {
    expect(calcTotalCop(68000, 5000)).toBe(73000);
  });
  it("empty draft has no items and zero fee", () => {
    const d = emptyDraft();
    expect(d.items).toEqual([]);
    expect(d.deliveryFeeCop).toBe(0);
  });
});

describe("state machine", () => {
  it("allows building -> awaiting_payment and building -> pending_review", () => {
    expect(canTransition("building", "awaiting_payment")).toBe(true);
    expect(canTransition("building", "pending_review")).toBe(true);
  });
  it("allows awaiting_payment -> pending_review", () => {
    expect(canTransition("awaiting_payment", "pending_review")).toBe(true);
  });
  it("allows pending_review -> approved and -> rejected", () => {
    expect(canTransition("pending_review", "approved")).toBe(true);
    expect(canTransition("pending_review", "rejected")).toBe(true);
  });
  it("rejects illegal jumps", () => {
    expect(canTransition("building", "approved")).toBe(false);
    expect(canTransition("approved", "rejected")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/order.test.ts`
Expected: FAIL — cannot find module `./order`.

- [ ] **Step 3: Write `src/domain/order.ts`**

```ts
export type PaymentMethod = "transfer" | "cash";

export type OrderStatus =
  | "building"
  | "awaiting_payment"
  | "pending_review"
  | "approved"
  | "rejected";

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
}

export interface OrderDraft {
  items: OrderItem[];
  customerName?: string;
  deliveryAddress?: string;
  zone?: string;
  deliveryFeeCop: number;
}

export interface Order {
  id: string;
  customerPhone: string;
  customerName: string;
  items: OrderItem[];
  deliveryAddress: string;
  zone: string;
  deliveryFeeCop: number;
  subtotalCop: number;
  totalCop: number;
  paymentMethod: PaymentMethod;
  proofImagePath: string | null;
  status: OrderStatus;
  createdAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}

export function calcSubtotalCop(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unitPriceCop, 0);
}

export function calcTotalCop(subtotalCop: number, deliveryFeeCop: number): number {
  return subtotalCop + deliveryFeeCop;
}

export function emptyDraft(): OrderDraft {
  return { items: [], deliveryFeeCop: 0 };
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  building: ["awaiting_payment", "pending_review"],
  awaiting_payment: ["pending_review"],
  pending_review: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/order.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/order.ts src/domain/order.test.ts
git commit -m "feat: add order domain types, pricing, and state machine"
```

---

## Task 4: Database schema + order repository

**Files:**
- Create: `prisma/schema.prisma`, `src/orders/orderRepository.ts`, `src/orders/memoryOrderRepository.ts`, `src/orders/prismaOrderRepository.ts`
- Test: `src/orders/memoryOrderRepository.test.ts`

**Interfaces:**
- Consumes: `Order`, `OrderItem`, `OrderStatus`, `PaymentMethod` from `src/domain/order`.
- Produces:
  - `const ORDER_REPOSITORY = Symbol("OrderRepository")` (DI token)
  - `interface CreateOrderInput { customerPhone: string; customerName: string; items: OrderItem[]; deliveryAddress: string; zone: string; deliveryFeeCop: number; subtotalCop: number; totalCop: number; paymentMethod: PaymentMethod; status: OrderStatus }`
  - `interface OrderRepository { create(input: CreateOrderInput): Promise<Order>; findById(id: string): Promise<Order | null>; updateStatus(id: string, status: OrderStatus, reviewedBy?: string): Promise<Order>; setProof(id: string, proofImagePath: string): Promise<Order> }`
  - `class MemoryOrderRepository implements OrderRepository` (sequential ids `"1"`, `"2"`, …)
  - `class PrismaOrderRepository implements OrderRepository`

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Order {
  id              String    @id @default(cuid())
  customerPhone   String
  customerName    String
  items           Json
  deliveryAddress String
  zone            String
  deliveryFeeCop  Int
  subtotalCop     Int
  totalCop        Int
  paymentMethod   String
  proofImagePath  String?
  status          String
  createdAt       DateTime  @default(now())
  reviewedBy      String?
  reviewedAt      DateTime?
}
```

- [ ] **Step 2: Generate the Prisma client and create the migration**

Run: `npx prisma migrate dev --name init`
Expected: creates `prisma/migrations/*_init` and generates the client. (Requires a running Postgres at `DATABASE_URL`.) If Postgres is unavailable, run `npx prisma generate` (no DB needed) so `@prisma/client` types exist for the build, and defer the migration to setup time.

- [ ] **Step 3: Write failing test** — `src/orders/memoryOrderRepository.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { MemoryOrderRepository } from "./memoryOrderRepository";
import type { CreateOrderInput } from "./orderRepository";

const input: CreateOrderInput = {
  customerPhone: "573001112233",
  customerName: "Ana",
  items: [{ productId: "wings_12", name: "12 alitas BBQ", quantity: 1, unitPriceCop: 32000 }],
  deliveryAddress: "Cra 70 # 1-2",
  zone: "laureles",
  deliveryFeeCop: 5000,
  subtotalCop: 32000,
  totalCop: 37000,
  paymentMethod: "transfer",
  status: "awaiting_payment",
};

describe("MemoryOrderRepository", () => {
  it("creates and finds an order", async () => {
    const repo = new MemoryOrderRepository();
    const created = await repo.create(input);
    expect(created.id).toBe("1");
    expect(created.status).toBe("awaiting_payment");
    expect((await repo.findById("1"))?.customerName).toBe("Ana");
  });

  it("updates status with reviewer and timestamp, and stores proof", async () => {
    const repo = new MemoryOrderRepository();
    await repo.create(input);
    await repo.setProof("1", "/proofs/1.jpg");
    const reviewed = await repo.updateStatus("1", "approved", "cocina");
    expect(reviewed.status).toBe("approved");
    expect(reviewed.reviewedBy).toBe("cocina");
    expect(reviewed.reviewedAt).toBeInstanceOf(Date);
    expect(reviewed.proofImagePath).toBe("/proofs/1.jpg");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/orders/memoryOrderRepository.test.ts`
Expected: FAIL — cannot find module `./memoryOrderRepository`.

- [ ] **Step 5: Write `src/orders/orderRepository.ts`**

```ts
import type { Order, OrderItem, OrderStatus, PaymentMethod } from "../domain/order";

export const ORDER_REPOSITORY = Symbol("OrderRepository");

export interface CreateOrderInput {
  customerPhone: string;
  customerName: string;
  items: OrderItem[];
  deliveryAddress: string;
  zone: string;
  deliveryFeeCop: number;
  subtotalCop: number;
  totalCop: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
}

export interface OrderRepository {
  create(input: CreateOrderInput): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  updateStatus(id: string, status: OrderStatus, reviewedBy?: string): Promise<Order>;
  setProof(id: string, proofImagePath: string): Promise<Order>;
}
```

- [ ] **Step 6: Write `src/orders/memoryOrderRepository.ts`**

```ts
import type { Order, OrderStatus } from "../domain/order";
import type { CreateOrderInput, OrderRepository } from "./orderRepository";

export class MemoryOrderRepository implements OrderRepository {
  private orders = new Map<string, Order>();
  private seq = 0;

  async create(input: CreateOrderInput): Promise<Order> {
    const id = String(++this.seq);
    const order: Order = {
      id,
      ...input,
      proofImagePath: null,
      createdAt: new Date(),
      reviewedBy: null,
      reviewedAt: null,
    };
    this.orders.set(id, order);
    return order;
  }

  async findById(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null;
  }

  async updateStatus(id: string, status: OrderStatus, reviewedBy?: string): Promise<Order> {
    const order = this.mustGet(id);
    const updated: Order = {
      ...order,
      status,
      reviewedBy: reviewedBy ?? order.reviewedBy,
      reviewedAt: new Date(),
    };
    this.orders.set(id, updated);
    return updated;
  }

  async setProof(id: string, proofImagePath: string): Promise<Order> {
    const order = this.mustGet(id);
    const updated: Order = { ...order, proofImagePath };
    this.orders.set(id, updated);
    return updated;
  }

  private mustGet(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new Error(`Order ${id} not found`);
    return order;
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/orders/memoryOrderRepository.test.ts`
Expected: PASS.

- [ ] **Step 8: Write `src/orders/prismaOrderRepository.ts`** (no unit test — exercised in Task 14 manual E2E)

```ts
import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { Order, OrderItem, OrderStatus, PaymentMethod } from "../domain/order";
import type { CreateOrderInput, OrderRepository } from "./orderRepository";

type Row = {
  id: string; customerPhone: string; customerName: string; items: unknown;
  deliveryAddress: string; zone: string; deliveryFeeCop: number; subtotalCop: number;
  totalCop: number; paymentMethod: string; proofImagePath: string | null; status: string;
  createdAt: Date; reviewedBy: string | null; reviewedAt: Date | null;
};

function toOrder(row: Row): Order {
  return {
    id: row.id,
    customerPhone: row.customerPhone,
    customerName: row.customerName,
    items: row.items as OrderItem[],
    deliveryAddress: row.deliveryAddress,
    zone: row.zone,
    deliveryFeeCop: row.deliveryFeeCop,
    subtotalCop: row.subtotalCop,
    totalCop: row.totalCop,
    paymentMethod: row.paymentMethod as PaymentMethod,
    proofImagePath: row.proofImagePath,
    status: row.status as OrderStatus,
    createdAt: row.createdAt,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
  };
}

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateOrderInput): Promise<Order> {
    const row = await this.prisma.order.create({
      data: { ...input, items: input.items as unknown as object },
    });
    return toOrder(row as Row);
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id } });
    return row ? toOrder(row as Row) : null;
  }

  async updateStatus(id: string, status: OrderStatus, reviewedBy?: string): Promise<Order> {
    const row = await this.prisma.order.update({
      where: { id },
      data: { status, reviewedBy: reviewedBy ?? undefined, reviewedAt: new Date() },
    });
    return toOrder(row as Row);
  }

  async setProof(id: string, proofImagePath: string): Promise<Order> {
    const row = await this.prisma.order.update({ where: { id }, data: { proofImagePath } });
    return toOrder(row as Row);
  }
}
```

- [ ] **Step 9: Verify the memory test still passes and the project type-checks**

Run: `npx vitest run src/orders/memoryOrderRepository.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. (If `@prisma/client` is not generated, run `npx prisma generate` first.)

- [ ] **Step 10: Commit**

```bash
git add prisma src/orders/orderRepository.ts src/orders/memoryOrderRepository.ts src/orders/memoryOrderRepository.test.ts src/orders/prismaOrderRepository.ts
git commit -m "feat: add Prisma schema and order repository (memory + prisma)"
```

---

## Task 5: Proof storage

**Files:**
- Create: `src/storage/proofStorage.ts`, `src/storage/memoryProofStorage.ts`, `src/storage/localProofStorage.ts`
- Test: `src/storage/localProofStorage.test.ts`

**Interfaces:**
- Produces:
  - `const PROOF_STORAGE = Symbol("ProofStorage")` (DI token)
  - `interface ProofStorage { save(orderId: string, bytes: Buffer, ext: string): Promise<string> }` — returns the stored path/identifier.
  - `class MemoryProofStorage implements ProofStorage` (exposes `saved: Map<string, Buffer>`)
  - `class LocalProofStorage implements ProofStorage` (constructor takes base dir)

- [ ] **Step 1: Write failing test** — `src/storage/localProofStorage.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { rm, readFile } from "node:fs/promises";
import { LocalProofStorage } from "./localProofStorage";

const dir = "./data/test-proofs";

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalProofStorage", () => {
  it("writes bytes to a file and returns its path", async () => {
    const storage = new LocalProofStorage(dir);
    const path = await storage.save("42", Buffer.from("hello"), "jpg");
    expect(path).toContain("42");
    expect(path.endsWith(".jpg")).toBe(true);
    expect((await readFile(path)).toString()).toBe("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/localProofStorage.test.ts`
Expected: FAIL — cannot find module `./localProofStorage`.

- [ ] **Step 3: Write `src/storage/proofStorage.ts`**

```ts
export const PROOF_STORAGE = Symbol("ProofStorage");

export interface ProofStorage {
  /** Persists proof bytes and returns a stable path/identifier. */
  save(orderId: string, bytes: Buffer, ext: string): Promise<string>;
}
```

- [ ] **Step 4: Write `src/storage/localProofStorage.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProofStorage } from "./proofStorage";

export class LocalProofStorage implements ProofStorage {
  constructor(private baseDir: string) {}

  async save(orderId: string, bytes: Buffer, ext: string): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const path = resolve(join(this.baseDir, `${orderId}.${ext}`));
    await writeFile(path, bytes);
    return path;
  }
}
```

- [ ] **Step 5: Write `src/storage/memoryProofStorage.ts`**

```ts
import type { ProofStorage } from "./proofStorage";

export class MemoryProofStorage implements ProofStorage {
  public saved = new Map<string, Buffer>();

  async save(orderId: string, bytes: Buffer, ext: string): Promise<string> {
    const path = `memory://${orderId}.${ext}`;
    this.saved.set(path, bytes);
    return path;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/storage/localProofStorage.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/storage
git commit -m "feat: add proof image storage (local + memory)"
```

---

## Task 6: Session store

**Files:**
- Create: `src/sessions/sessionStore.ts`
- Test: `src/sessions/sessionStore.test.ts`

**Interfaces:**
- Consumes: `OrderDraft`, `emptyDraft` from `src/domain/order`.
- Produces:
  - `const SESSION_STORE = Symbol("SessionStore")` (DI token)
  - `interface LlmMessage { role: "user" | "assistant"; content: unknown }`
  - `interface Session { phone: string; history: LlmMessage[]; draft: OrderDraft; updatedAt: Date; lastOrderId?: string }`
  - `interface SessionStore { get(phone: string): Session; reset(phone: string): void; save(session: Session): void }`
  - `class MemorySessionStore implements SessionStore` (creates a fresh session with `emptyDraft()` on first `get`)

- [ ] **Step 1: Write failing test** — `src/sessions/sessionStore.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { MemorySessionStore } from "./sessionStore";

describe("MemorySessionStore", () => {
  it("creates a fresh empty session on first get", () => {
    const store = new MemorySessionStore();
    const s = store.get("573001112233");
    expect(s.phone).toBe("573001112233");
    expect(s.draft.items).toEqual([]);
    expect(s.history).toEqual([]);
  });

  it("persists mutations across gets via save", () => {
    const store = new MemorySessionStore();
    const s = store.get("57300");
    s.draft.customerName = "Ana";
    store.save(s);
    expect(store.get("57300").draft.customerName).toBe("Ana");
  });

  it("reset clears the session", () => {
    const store = new MemorySessionStore();
    const s = store.get("57300");
    s.draft.customerName = "Ana";
    store.save(s);
    store.reset("57300");
    expect(store.get("57300").draft.customerName).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sessions/sessionStore.test.ts`
Expected: FAIL — cannot find module `./sessionStore`.

- [ ] **Step 3: Write `src/sessions/sessionStore.ts`**

```ts
import { emptyDraft, type OrderDraft } from "../domain/order";

export const SESSION_STORE = Symbol("SessionStore");

export interface LlmMessage {
  role: "user" | "assistant";
  content: unknown;
}

export interface Session {
  phone: string;
  history: LlmMessage[];
  draft: OrderDraft;
  updatedAt: Date;
  lastOrderId?: string;
}

export interface SessionStore {
  get(phone: string): Session;
  reset(phone: string): void;
  save(session: Session): void;
}

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  get(phone: string): Session {
    const existing = this.sessions.get(phone);
    if (existing) return existing;
    const fresh: Session = { phone, history: [], draft: emptyDraft(), updatedAt: new Date() };
    this.sessions.set(phone, fresh);
    return fresh;
  }

  reset(phone: string): void {
    this.sessions.delete(phone);
  }

  save(session: Session): void {
    session.updatedAt = new Date();
    this.sessions.set(session.phone, session);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sessions/sessionStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sessions
git commit -m "feat: add in-memory conversation session store"
```

---

## Task 7: Order service

**Files:**
- Create: `src/orders/orderService.ts`
- Test: `src/orders/orderService.test.ts`

**Interfaces:**
- Consumes: `OrderRepository`, `CreateOrderInput`, `ORDER_REPOSITORY` (Task 4); `OrderDraft`, `Order`, `PaymentMethod`, `canTransition`, `calcSubtotalCop`, `calcTotalCop` (Task 3).
- Produces:
  - `@Injectable() class OrderService`:
    - `constructor(@Inject(ORDER_REPOSITORY) private repo: OrderRepository)`
    - `confirm(phone: string, draft: OrderDraft, paymentMethod: PaymentMethod): Promise<Order>` — validates the draft, computes totals, sets status (`awaiting_payment` for transfer, `pending_review` for cash), persists.
    - `attachProof(orderId: string, proofImagePath: string): Promise<Order>` — sets proof, transitions to `pending_review`.
    - `review(orderId: string, decision: "approved" | "rejected", reviewedBy: string): Promise<Order>`.
    - `getById(orderId: string): Promise<Order | null>`.

- [ ] **Step 1: Write failing test** — `src/orders/orderService.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { OrderService } from "./orderService";
import { MemoryOrderRepository } from "./memoryOrderRepository";
import type { OrderDraft } from "../domain/order";

function draft(): OrderDraft {
  return {
    items: [{ productId: "wings_12", name: "12 alitas BBQ", quantity: 1, unitPriceCop: 32000 }],
    customerName: "Ana",
    deliveryAddress: "Cra 70 # 1-2",
    zone: "laureles",
    deliveryFeeCop: 5000,
  };
}

describe("OrderService.confirm", () => {
  it("transfer order starts as awaiting_payment with computed totals", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "transfer");
    expect(order.status).toBe("awaiting_payment");
    expect(order.subtotalCop).toBe(32000);
    expect(order.totalCop).toBe(37000);
  });

  it("cash order goes straight to pending_review", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "cash");
    expect(order.status).toBe("pending_review");
  });

  it("rejects an incomplete draft", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const bad = { ...draft(), items: [] };
    await expect(svc.confirm("57300", bad, "cash")).rejects.toThrow();
  });
});

describe("OrderService.attachProof and review", () => {
  it("attaching proof moves awaiting_payment -> pending_review", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "transfer");
    const withProof = await svc.attachProof(order.id, "/proofs/x.jpg");
    expect(withProof.status).toBe("pending_review");
    expect(withProof.proofImagePath).toBe("/proofs/x.jpg");
  });

  it("review approves from pending_review", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "cash");
    const approved = await svc.review(order.id, "approved", "cocina");
    expect(approved.status).toBe("approved");
  });

  it("review refuses an illegal transition", async () => {
    const svc = new OrderService(new MemoryOrderRepository());
    const order = await svc.confirm("57300", draft(), "transfer"); // awaiting_payment
    await expect(svc.review(order.id, "approved", "cocina")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/orders/orderService.test.ts`
Expected: FAIL — cannot find module `./orderService`.

- [ ] **Step 3: Write `src/orders/orderService.ts`**

```ts
import { Inject, Injectable } from "@nestjs/common";
import {
  calcSubtotalCop, calcTotalCop, canTransition,
  type Order, type OrderDraft, type PaymentMethod,
} from "../domain/order";
import { ORDER_REPOSITORY, type CreateOrderInput, type OrderRepository } from "./orderRepository";

@Injectable()
export class OrderService {
  constructor(@Inject(ORDER_REPOSITORY) private repo: OrderRepository) {}

  async confirm(phone: string, draft: OrderDraft, paymentMethod: PaymentMethod): Promise<Order> {
    if (draft.items.length === 0) throw new Error("Draft has no items");
    if (!draft.customerName) throw new Error("Missing customer name");
    if (!draft.deliveryAddress) throw new Error("Missing delivery address");
    if (!draft.zone) throw new Error("Missing zone");

    const subtotalCop = calcSubtotalCop(draft.items);
    const totalCop = calcTotalCop(subtotalCop, draft.deliveryFeeCop);
    const status = paymentMethod === "transfer" ? "awaiting_payment" : "pending_review";

    const input: CreateOrderInput = {
      customerPhone: phone,
      customerName: draft.customerName,
      items: draft.items,
      deliveryAddress: draft.deliveryAddress,
      zone: draft.zone,
      deliveryFeeCop: draft.deliveryFeeCop,
      subtotalCop,
      totalCop,
      paymentMethod,
      status,
    };
    return this.repo.create(input);
  }

  async attachProof(orderId: string, proofImagePath: string): Promise<Order> {
    const order = await this.mustGet(orderId);
    if (!canTransition(order.status, "pending_review")) {
      throw new Error(`Cannot attach proof from ${order.status}`);
    }
    await this.repo.setProof(orderId, proofImagePath);
    return this.repo.updateStatus(orderId, "pending_review");
  }

  async review(
    orderId: string,
    decision: "approved" | "rejected",
    reviewedBy: string,
  ): Promise<Order> {
    const order = await this.mustGet(orderId);
    if (!canTransition(order.status, decision)) {
      throw new Error(`Cannot ${decision} from ${order.status}`);
    }
    return this.repo.updateStatus(orderId, decision, reviewedBy);
  }

  getById(orderId: string): Promise<Order | null> {
    return this.repo.findById(orderId);
  }

  private async mustGet(orderId: string): Promise<Order> {
    const order = await this.repo.findById(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    return order;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/orders/orderService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orders/orderService.ts src/orders/orderService.test.ts
git commit -m "feat: add order service with confirm/proof/review flow"
```

---

## Task 8: WhatsApp client + webhook parsing

**Files:**
- Create: `src/whatsapp/client.ts`, `src/whatsapp/cloudApiClient.ts`, `src/whatsapp/webhook.ts`
- Test: `src/whatsapp/webhook.test.ts`, `src/whatsapp/client.test.ts`

**Interfaces:**
- Produces:
  - `const WHATSAPP_CLIENT = Symbol("WhatsAppClient")` (DI token)
  - `interface WhatsAppClient { sendText(to: string, text: string): Promise<void>; sendImage(to: string, imagePath: string, caption?: string): Promise<void>; downloadMedia(mediaId: string): Promise<{ bytes: Buffer; ext: string }> }`
  - `class FakeWhatsAppClient implements WhatsAppClient` (records `sent: SentMessage[]`; `downloadMedia` returns fixed buffer + `"jpg"`)
  - `class CloudApiWhatsAppClient implements WhatsAppClient`
  - `type InboundMessage = { from: string; messageId: string; kind: "text"; text: string } | { from: string; messageId: string; kind: "image"; mediaId: string }`
  - `parseWebhook(body: unknown): InboundMessage[]`

- [ ] **Step 1: Write failing test** — `src/whatsapp/webhook.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseWebhook } from "./webhook";

const textPayload = {
  entry: [{ changes: [{ value: { messages: [
    { from: "573001112233", id: "wamid.1", type: "text", text: { body: "hola" } },
  ] } }] }],
};

const imagePayload = {
  entry: [{ changes: [{ value: { messages: [
    { from: "573001112233", id: "wamid.2", type: "image", image: { id: "media-9" } },
  ] } }] }],
};

describe("parseWebhook", () => {
  it("parses a text message", () => {
    const [msg] = parseWebhook(textPayload);
    expect(msg).toEqual({ from: "573001112233", messageId: "wamid.1", kind: "text", text: "hola" });
  });

  it("parses an image message", () => {
    const [msg] = parseWebhook(imagePayload);
    expect(msg).toEqual({ from: "573001112233", messageId: "wamid.2", kind: "image", mediaId: "media-9" });
  });

  it("returns empty array for status-only or malformed payloads", () => {
    expect(parseWebhook({ entry: [{ changes: [{ value: { statuses: [] } }] }] })).toEqual([]);
    expect(parseWebhook({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/whatsapp/webhook.test.ts`
Expected: FAIL — cannot find module `./webhook`.

- [ ] **Step 3: Write `src/whatsapp/webhook.ts`**

```ts
export type InboundMessage =
  | { from: string; messageId: string; kind: "text"; text: string }
  | { from: string; messageId: string; kind: "image"; mediaId: string };

export function parseWebhook(body: unknown): InboundMessage[] {
  const result: InboundMessage[] = [];
  const b = body as any;
  const entries = Array.isArray(b?.entry) ? b.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const messages = change?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        if (m.type === "text" && m.text?.body) {
          result.push({ from: m.from, messageId: m.id, kind: "text", text: m.text.body });
        } else if (m.type === "image" && m.image?.id) {
          result.push({ from: m.from, messageId: m.id, kind: "image", mediaId: m.image.id });
        }
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/whatsapp/webhook.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test** — `src/whatsapp/client.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { FakeWhatsAppClient } from "./client";

describe("FakeWhatsAppClient", () => {
  it("records sent text and images", async () => {
    const wa = new FakeWhatsAppClient();
    await wa.sendText("57300", "hola");
    await wa.sendImage("57300", "/qr.png", "Escanea");
    expect(wa.sent).toEqual([
      { to: "57300", kind: "text", text: "hola" },
      { to: "57300", kind: "image", imagePath: "/qr.png", caption: "Escanea" },
    ]);
  });

  it("downloadMedia returns bytes and ext", async () => {
    const wa = new FakeWhatsAppClient();
    const { bytes, ext } = await wa.downloadMedia("media-9");
    expect(bytes.length).toBeGreaterThan(0);
    expect(ext).toBe("jpg");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/whatsapp/client.test.ts`
Expected: FAIL — cannot find module `./client`.

- [ ] **Step 7: Write `src/whatsapp/client.ts`**

```ts
export const WHATSAPP_CLIENT = Symbol("WhatsAppClient");

export interface WhatsAppClient {
  sendText(to: string, text: string): Promise<void>;
  sendImage(to: string, imagePath: string, caption?: string): Promise<void>;
  downloadMedia(mediaId: string): Promise<{ bytes: Buffer; ext: string }>;
}

type SentMessage =
  | { to: string; kind: "text"; text: string }
  | { to: string; kind: "image"; imagePath: string; caption?: string };

export class FakeWhatsAppClient implements WhatsAppClient {
  public sent: SentMessage[] = [];

  async sendText(to: string, text: string): Promise<void> {
    this.sent.push({ to, kind: "text", text });
  }

  async sendImage(to: string, imagePath: string, caption?: string): Promise<void> {
    this.sent.push({ to, kind: "image", imagePath, caption });
  }

  async downloadMedia(_mediaId: string): Promise<{ bytes: Buffer; ext: string }> {
    return { bytes: Buffer.from("fake-image-bytes"), ext: "jpg" };
  }
}
```

- [ ] **Step 8: Write `src/whatsapp/cloudApiClient.ts`** (no unit test — verified in manual E2E, Task 14)

```ts
import { readFile } from "node:fs/promises";
import type { WhatsAppClient } from "./client";

const GRAPH = "https://graph.facebook.com/v21.0";

export class CloudApiWhatsAppClient implements WhatsAppClient {
  constructor(private token: string, private phoneNumberId: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  }

  async sendText(to: string, text: string): Promise<void> {
    await this.post({ messaging_product: "whatsapp", to, type: "text", text: { body: text } });
  }

  async sendImage(to: string, imagePath: string, caption?: string): Promise<void> {
    const bytes = await readFile(imagePath);
    const mediaId = await this.uploadMedia(bytes, "image/png");
    await this.post({
      messaging_product: "whatsapp", to, type: "image",
      image: { id: mediaId, caption },
    });
  }

  async downloadMedia(mediaId: string): Promise<{ bytes: Buffer; ext: string }> {
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: this.headers() });
    const meta = (await metaRes.json()) as { url: string; mime_type: string };
    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    const ext = meta.mime_type.split("/")[1] ?? "jpg";
    return { bytes, ext };
  }

  private async uploadMedia(bytes: Buffer, mime: string): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([bytes], { type: mime }));
    const res = await fetch(`${GRAPH}/${this.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  private async post(payload: object): Promise<void> {
    const res = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 9: Run tests + type-check**

Run: `npx vitest run src/whatsapp && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/whatsapp
git commit -m "feat: add WhatsApp client (fake + Cloud API) and webhook parsing"
```

---

## Task 9: Agent tools

**Files:**
- Create: `src/agent/tools.ts`
- Test: `src/agent/tools.test.ts`

**Interfaces:**
- Consumes: `getMenu`, `findProduct` (Task 2); `validateZone` (Task 2); `OrderService` (Task 7); `Session`, `SessionStore` (Task 6); `WhatsAppClient` (Task 8); `calcSubtotalCop`, `calcTotalCop`, `PaymentMethod` (Task 3).
- Produces:
  - `interface ToolContext { session: Session; store: SessionStore; orders: OrderService; whatsapp: WhatsAppClient; staffChatId: string; qrImagePath: string }`
  - `interface ToolDef { name: string; description: string; input_schema: object }`
  - `const TOOL_DEFS: ToolDef[]`
  - `async function runTool(name: string, input: any, ctx: ToolContext): Promise<{ result: string; confirmedOrderId?: string }>`
- Tool names: `get_menu`, `validate_zone`, `add_item`, `remove_item`, `set_customer_details`, `summarize_order`, `confirm_order`, `send_qr`.

- [ ] **Step 1: Write failing test** — `src/agent/tools.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { runTool, type ToolContext } from "./tools";
import { MemorySessionStore } from "../sessions/sessionStore";
import { OrderService } from "../orders/orderService";
import { MemoryOrderRepository } from "../orders/memoryOrderRepository";
import { FakeWhatsAppClient } from "../whatsapp/client";

function ctx(): ToolContext {
  const store = new MemorySessionStore();
  return {
    session: store.get("57300"),
    store,
    orders: new OrderService(new MemoryOrderRepository()),
    whatsapp: new FakeWhatsAppClient(),
    staffChatId: "staff-1",
    qrImagePath: "/qr.png",
  };
}

describe("runTool", () => {
  it("get_menu lists products", async () => {
    const { result } = await runTool("get_menu", {}, ctx());
    expect(result).toContain("alitas");
  });

  it("validate_zone reports coverage", async () => {
    const { result } = await runTool("validate_zone", { neighborhood: "Laureles" }, ctx());
    expect(result.toLowerCase()).toContain("cubre");
  });

  it("add_item adds a known product to the draft", async () => {
    const c = ctx();
    await runTool("add_item", { productId: "wings_12", quantity: 2 }, c);
    expect(c.session.draft.items[0]).toMatchObject({ productId: "wings_12", quantity: 2 });
  });

  it("add_item rejects an unknown product", async () => {
    const { result } = await runTool("add_item", { productId: "nope", quantity: 1 }, ctx());
    expect(result.toLowerCase()).toContain("no existe");
  });

  it("confirm_order requires a complete draft", async () => {
    const { result } = await runTool("confirm_order", { paymentMethod: "cash" }, ctx());
    expect(result.toLowerCase()).toContain("falta");
  });

  it("confirm_order (transfer) creates an order and reports its id", async () => {
    const c = ctx();
    await runTool("add_item", { productId: "wings_12", quantity: 1 }, c);
    await runTool("set_customer_details", { name: "Ana", address: "Cra 70", neighborhood: "Laureles" }, c);
    const { result, confirmedOrderId } = await runTool("confirm_order", { paymentMethod: "transfer" }, c);
    expect(confirmedOrderId).toBeDefined();
    expect(result.toLowerCase()).toContain("transferencia");
  });

  it("send_qr sends the QR image to the customer", async () => {
    const c = ctx();
    await runTool("send_qr", {}, c);
    const wa = c.whatsapp as FakeWhatsAppClient;
    expect(wa.sent.some((m) => m.kind === "image" && m.imagePath === "/qr.png")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent/tools.test.ts`
Expected: FAIL — cannot find module `./tools`.

- [ ] **Step 3: Write `src/agent/tools.ts`**

```ts
import { getMenu, findProduct } from "../config/menu";
import { validateZone } from "../config/zones";
import type { OrderService } from "../orders/orderService";
import type { Session, SessionStore } from "../sessions/sessionStore";
import type { WhatsAppClient } from "../whatsapp/client";
import { calcSubtotalCop, calcTotalCop, type PaymentMethod } from "../domain/order";

export interface ToolContext {
  session: Session;
  store: SessionStore;
  orders: OrderService;
  whatsapp: WhatsAppClient;
  staffChatId: string;
  qrImagePath: string;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

export const TOOL_DEFS: ToolDef[] = [
  { name: "get_menu", description: "Devuelve el menú con productos y precios.", input_schema: { type: "object", properties: {} } },
  { name: "validate_zone", description: "Verifica si hay cobertura de domicilio en un barrio y el costo.", input_schema: { type: "object", properties: { neighborhood: { type: "string" } }, required: ["neighborhood"] } },
  { name: "add_item", description: "Agrega un producto al pedido por su productId.", input_schema: { type: "object", properties: { productId: { type: "string" }, quantity: { type: "integer", minimum: 1 } }, required: ["productId", "quantity"] } },
  { name: "remove_item", description: "Quita un producto del pedido por su productId.", input_schema: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"] } },
  { name: "set_customer_details", description: "Guarda nombre, dirección y barrio del cliente.", input_schema: { type: "object", properties: { name: { type: "string" }, address: { type: "string" }, neighborhood: { type: "string" } }, required: ["name", "address", "neighborhood"] } },
  { name: "summarize_order", description: "Devuelve el resumen del pedido con totales.", input_schema: { type: "object", properties: {} } },
  { name: "confirm_order", description: "Confirma el pedido con el método de pago (transfer o cash).", input_schema: { type: "object", properties: { paymentMethod: { type: "string", enum: ["transfer", "cash"] } }, required: ["paymentMethod"] } },
  { name: "send_qr", description: "Envía el código QR de pago por transferencia al cliente.", input_schema: { type: "object", properties: {} } },
];

function cop(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

export async function runTool(
  name: string,
  input: any,
  ctx: ToolContext,
): Promise<{ result: string; confirmedOrderId?: string }> {
  const draft = ctx.session.draft;

  switch (name) {
    case "get_menu": {
      const lines = getMenu().map((p) => `- ${p.id}: ${p.name} — ${cop(p.priceCop)}`);
      return { result: `Menú:\n${lines.join("\n")}` };
    }

    case "validate_zone": {
      const z = validateZone(String(input.neighborhood));
      return {
        result: z.covered
          ? `Sí se cubre ${z.neighborhood}. Domicilio: ${cop(z.deliveryFeeCop)}.`
          : `No se cubre ${z.neighborhood}. No hay cobertura de domicilio allí.`,
      };
    }

    case "add_item": {
      const product = findProduct(String(input.productId));
      if (!product) return { result: `El producto "${input.productId}" no existe en el menú.` };
      const qty = Number(input.quantity);
      const existing = draft.items.find((i) => i.productId === product.id);
      if (existing) existing.quantity += qty;
      else draft.items.push({ productId: product.id, name: product.name, quantity: qty, unitPriceCop: product.priceCop });
      ctx.store.save(ctx.session);
      return { result: `Agregado: ${qty} x ${product.name}.` };
    }

    case "remove_item": {
      draft.items = draft.items.filter((i) => i.productId !== String(input.productId));
      ctx.store.save(ctx.session);
      return { result: `Producto quitado del pedido.` };
    }

    case "set_customer_details": {
      draft.customerName = String(input.name);
      draft.deliveryAddress = String(input.address);
      const z = validateZone(String(input.neighborhood));
      if (!z.covered) return { result: `No hay cobertura en ${z.neighborhood}. No se puede tomar el domicilio.` };
      draft.zone = z.neighborhood;
      draft.deliveryFeeCop = z.deliveryFeeCop;
      ctx.store.save(ctx.session);
      return { result: `Datos guardados. Domicilio a ${z.neighborhood}: ${cop(z.deliveryFeeCop)}.` };
    }

    case "summarize_order": {
      if (draft.items.length === 0) return { result: "El pedido está vacío." };
      const subtotal = calcSubtotalCop(draft.items);
      const total = calcTotalCop(subtotal, draft.deliveryFeeCop);
      const lines = draft.items.map((i) => `- ${i.quantity} x ${i.name} (${cop(i.unitPriceCop)})`);
      return {
        result: [
          "Resumen del pedido:",
          ...lines,
          `Subtotal: ${cop(subtotal)}`,
          `Domicilio: ${cop(draft.deliveryFeeCop)}`,
          `Total: ${cop(total)}`,
          draft.customerName ? `Cliente: ${draft.customerName}` : "Falta nombre",
          draft.deliveryAddress ? `Dirección: ${draft.deliveryAddress}` : "Falta dirección",
        ].join("\n"),
      };
    }

    case "confirm_order": {
      const missing: string[] = [];
      if (draft.items.length === 0) missing.push("productos");
      if (!draft.customerName) missing.push("nombre");
      if (!draft.deliveryAddress) missing.push("dirección");
      if (!draft.zone) missing.push("barrio con cobertura");
      if (missing.length) return { result: `Falta información: ${missing.join(", ")}.` };

      const method = input.paymentMethod as PaymentMethod;
      const order = await ctx.orders.confirm(ctx.session.phone, draft, method);
      const total = cop(order.totalCop);
      if (method === "transfer") {
        return {
          result: `Pedido #${order.id} creado por ${total}. Pago por transferencia: envía el QR y pide el comprobante.`,
          confirmedOrderId: order.id,
        };
      }
      return {
        result: `Pedido #${order.id} creado por ${total}. Pago en efectivo contra entrega. Queda pendiente de confirmación del local.`,
        confirmedOrderId: order.id,
      };
    }

    case "send_qr": {
      await ctx.whatsapp.sendImage(
        ctx.session.phone,
        ctx.qrImagePath,
        "Escanea este QR para pagar por transferencia y envíanos la foto del comprobante.",
      );
      return { result: "QR de pago enviado al cliente." };
    }

    default:
      return { result: `Herramienta desconocida: ${name}.` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/agent/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts src/agent/tools.test.ts
git commit -m "feat: add agent tools (menu, zone, items, confirm, qr)"
```

---

## Task 10: System prompt + LLM client interface

**Files:**
- Create: `src/agent/prompt.ts`, `src/agent/llmClient.ts`, `src/agent/anthropicLlmClient.ts`
- Test: `src/agent/prompt.test.ts`

**Interfaces:**
- Consumes: `hoursText` (Task 2); `LlmMessage` (Task 6).
- Produces:
  - `function buildSystemPrompt(): string`
  - `const LLM_CLIENT = Symbol("LlmClient")` (DI token)
  - `interface LlmToolUse { id: string; name: string; input: any }`
  - `interface LlmResponse { text: string; toolUses: LlmToolUse[]; stopReason: "tool_use" | "end" }`
  - `interface LlmClient { complete(system: string, messages: LlmMessage[], tools: object[]): Promise<LlmResponse> }`
  - `class AnthropicLlmClient implements LlmClient`

- [ ] **Step 1: Write failing test** — `src/agent/prompt.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("is in Spanish and forbids inventing data", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/alitas/i);
    expect(p).toMatch(/nunca inventes/i);
    expect(p).toMatch(/herramientas/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent/prompt.test.ts`
Expected: FAIL — cannot find module `./prompt`.

- [ ] **Step 3: Write `src/agent/prompt.ts`**

```ts
import { hoursText } from "../config/businessHours";

export function buildSystemPrompt(): string {
  return [
    "Eres el asistente de pedidos por WhatsApp de un negocio de alitas BBQ en Colombia.",
    "Hablas en español, con tono cercano, amable y breve (es un chat de WhatsApp).",
    "",
    "Tu trabajo es llevar al cliente por todo el pedido:",
    "1) Mostrar el menú cuando lo pidan (usa get_menu).",
    "2) Tomar los productos que quieren (usa add_item / remove_item).",
    "3) Pedir nombre, dirección y barrio (usa set_customer_details).",
    "4) Confirmar el resumen con el cliente (usa summarize_order) antes de cerrar.",
    "5) Preguntar el método de pago: transferencia o efectivo contra entrega.",
    "6) Cerrar el pedido con confirm_order.",
    "7) Si es transferencia, envía el QR con send_qr y pide la foto del comprobante.",
    "",
    "Reglas estrictas:",
    "- NUNCA inventes precios, productos, cobertura ni costos de domicilio.",
    "  Usa SIEMPRE las herramientas; ellas son la única fuente de verdad.",
    "- Si un barrio no tiene cobertura, discúlpate y explica que no llegan allá.",
    "- TÚ NUNCA confirmas que un pago fue recibido; eso lo aprueba una persona del local.",
    "  Cuando llegue el comprobante, agradece y di que queda en revisión.",
    `- Horario: ${hoursText()} Fuera de horario, informa y no tomes pedidos.`,
    "- No pidas datos que ya tienes. Sé eficiente en hora pico.",
  ].join("\n");
}
```

- [ ] **Step 4: Write `src/agent/llmClient.ts`**

```ts
import type { LlmMessage } from "../sessions/sessionStore";

export const LLM_CLIENT = Symbol("LlmClient");

export interface LlmToolUse {
  id: string;
  name: string;
  input: any;
}

export interface LlmResponse {
  text: string;
  toolUses: LlmToolUse[];
  stopReason: "tool_use" | "end";
}

export interface LlmClient {
  complete(system: string, messages: LlmMessage[], tools: object[]): Promise<LlmResponse>;
}
```

- [ ] **Step 5: Write `src/agent/anthropicLlmClient.ts`** (no unit test — driven by scripted fake in Task 11, live in Task 14)

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { LlmMessage } from "../sessions/sessionStore";
import type { LlmClient, LlmResponse, LlmToolUse } from "./llmClient";

export class AnthropicLlmClient implements LlmClient {
  private client: Anthropic;
  constructor(apiKey: string, private model = "claude-sonnet-5") {
    this.client = new Anthropic({ apiKey });
  }

  async complete(system: string, messages: LlmMessage[], tools: object[]): Promise<LlmResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      tools: tools as any,
      messages: messages as any,
    });

    let text = "";
    const toolUses: LlmToolUse[] = [];
    for (const block of res.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      }
    }
    return { text, toolUses, stopReason: res.stop_reason === "tool_use" ? "tool_use" : "end" };
  }
}
```

- [ ] **Step 6: Run test + type-check**

Run: `npx vitest run src/agent/prompt.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/agent/prompt.ts src/agent/prompt.test.ts src/agent/llmClient.ts src/agent/anthropicLlmClient.ts
git commit -m "feat: add Spanish system prompt and LLM client interface"
```

---

## Task 11: Conversation orchestrator

**Files:**
- Create: `src/agent/orchestrator.ts`
- Test: `src/agent/orchestrator.test.ts`

**Interfaces:**
- Consumes: `LlmClient`, `LlmResponse`, `LLM_CLIENT` (Task 10); `buildSystemPrompt` (Task 10); `TOOL_DEFS`, `runTool`, `ToolContext` (Task 9); `SessionStore`, `SESSION_STORE` (Task 6); `OrderService` (Task 7); `WhatsAppClient`, `WHATSAPP_CLIENT` (Task 8); `ProofStorage`, `PROOF_STORAGE` (Task 5); `isOpen`, `hoursText` (Task 2); `Order` (Task 3); `BOT_CONFIG`, `BotConfig` (defined here for the first time — see Step 3).
- Produces:
  - `@Injectable() class Orchestrator` with constructor injecting `LLM_CLIENT`, `SESSION_STORE`, `OrderService`, `WHATSAPP_CLIENT`, `PROOF_STORAGE`, `BOT_CONFIG`.
  - `handleText(phone: string, text: string): Promise<string[]>` (returns assistant messages sent).
  - `handleImage(phone: string, mediaId: string): Promise<void>`.
  - `notifyStaffPendingReview(order: Order): Promise<void>`.

- [ ] **Step 1: Write failing test** — `src/agent/orchestrator.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { Orchestrator } from "./orchestrator";
import { MemorySessionStore } from "../sessions/sessionStore";
import { OrderService } from "../orders/orderService";
import { MemoryOrderRepository } from "../orders/memoryOrderRepository";
import { FakeWhatsAppClient } from "../whatsapp/client";
import { MemoryProofStorage } from "../storage/memoryProofStorage";
import type { BotConfig } from "../bot/botConfig";
import type { LlmClient, LlmResponse } from "./llmClient";

class ScriptedLlm implements LlmClient {
  constructor(private script: LlmResponse[]) {}
  async complete(): Promise<LlmResponse> {
    const next = this.script.shift();
    if (!next) throw new Error("Script exhausted");
    return next;
  }
}

function build(llm: LlmClient, repo = new MemoryOrderRepository()) {
  const store = new MemorySessionStore();
  const orders = new OrderService(repo);
  const whatsapp = new FakeWhatsAppClient();
  const storage = new MemoryProofStorage();
  const config: BotConfig = {
    staffChatId: "staff-1",
    qrImagePath: "/qr.png",
    now: () => new Date(2026, 6, 9, 19, 0), // open hours
  };
  const orch = new Orchestrator(llm, store, orders, whatsapp, storage, config);
  return { orch, store, orders, whatsapp, storage, repo, config };
}

describe("Orchestrator.handleText", () => {
  it("runs a tool then returns the model's final text", async () => {
    const llm = new ScriptedLlm([
      { text: "", toolUses: [{ id: "t1", name: "get_menu", input: {} }], stopReason: "tool_use" },
      { text: "Estos son nuestros combos 🍗", toolUses: [], stopReason: "end" },
    ]);
    const { orch, whatsapp } = build(llm);
    const out = await orch.handleText("57300", "¿qué tienen?");
    expect(out.join(" ")).toContain("combos");
    expect(whatsapp.sent.some((m) => m.kind === "text" && m.text.includes("combos"))).toBe(true);
  });

  it("outside business hours replies with hours and does not call the LLM", async () => {
    const llm = new ScriptedLlm([]); // must not be used
    const store = new MemorySessionStore();
    const orders = new OrderService(new MemoryOrderRepository());
    const whatsapp = new FakeWhatsAppClient();
    const config: BotConfig = {
      staffChatId: "staff-1", qrImagePath: "/qr.png",
      now: () => new Date(2026, 6, 9, 4, 0), // closed
    };
    const orch = new Orchestrator(llm, store, orders, whatsapp, new MemoryProofStorage(), config);
    const out = await orch.handleText("57300", "hola");
    expect(out.join(" ")).toMatch(/horario|p\.m\./i);
  });
});

describe("Orchestrator.handleImage", () => {
  it("stores proof, attaches to awaiting order, notifies staff", async () => {
    const repo = new MemoryOrderRepository();
    const { orch, store, whatsapp } = build(new ScriptedLlm([]), repo);
    const orders = new OrderService(repo);
    const order = await orders.confirm(
      "57300",
      { items: [{ productId: "wings_12", name: "12 alitas BBQ", quantity: 1, unitPriceCop: 32000 }],
        customerName: "Ana", deliveryAddress: "Cra 70", zone: "laureles", deliveryFeeCop: 5000 },
      "transfer",
    );
    const s = store.get("57300");
    s.lastOrderId = order.id;
    store.save(s);

    await orch.handleImage("57300", "media-9");

    const updated = await repo.findById(order.id);
    expect(updated?.status).toBe("pending_review");
    expect(updated?.proofImagePath).toBeDefined();
    expect(whatsapp.sent.some((m) => m.to === "staff-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/agent/orchestrator.test.ts`
Expected: FAIL — cannot find module `./orchestrator` (and `../bot/botConfig`).

- [ ] **Step 3: Write `src/bot/botConfig.ts`** (the injectable bot config, defined here because the orchestrator is its first consumer)

```ts
export const BOT_CONFIG = Symbol("BotConfig");

export interface BotConfig {
  staffChatId: string;
  qrImagePath: string;
  now: () => Date;
}
```

- [ ] **Step 4: Write `src/agent/orchestrator.ts`**

```ts
import { Inject, Injectable } from "@nestjs/common";
import { LLM_CLIENT, type LlmClient } from "./llmClient";
import { SESSION_STORE, type SessionStore } from "../sessions/sessionStore";
import { OrderService } from "../orders/orderService";
import { WHATSAPP_CLIENT, type WhatsAppClient } from "../whatsapp/client";
import { PROOF_STORAGE, type ProofStorage } from "../storage/proofStorage";
import { BOT_CONFIG, type BotConfig } from "../bot/botConfig";
import type { Order } from "../domain/order";
import { buildSystemPrompt } from "./prompt";
import { TOOL_DEFS, runTool, type ToolContext } from "./tools";
import { isOpen, hoursText } from "../config/businessHours";

const MAX_TOOL_ROUNDS = 8;

@Injectable()
export class Orchestrator {
  constructor(
    @Inject(LLM_CLIENT) private llm: LlmClient,
    @Inject(SESSION_STORE) private store: SessionStore,
    private orders: OrderService,
    @Inject(WHATSAPP_CLIENT) private whatsapp: WhatsAppClient,
    @Inject(PROOF_STORAGE) private storage: ProofStorage,
    @Inject(BOT_CONFIG) private config: BotConfig,
  ) {}

  async handleText(phone: string, text: string): Promise<string[]> {
    if (!isOpen(this.config.now())) {
      const msg = `¡Hola! En este momento estamos cerrados. ${hoursText()} Escríbenos en ese horario y con gusto te tomamos el pedido. 🍗`;
      await this.whatsapp.sendText(phone, msg);
      return [msg];
    }

    const session = this.store.get(phone);
    session.history.push({ role: "user", content: [{ type: "text", text }] });

    const system = buildSystemPrompt();
    const replies: string[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.llm.complete(system, session.history, TOOL_DEFS);

      const assistantContent: any[] = [];
      if (res.text) assistantContent.push({ type: "text", text: res.text });
      for (const tu of res.toolUses) {
        assistantContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      }
      session.history.push({ role: "assistant", content: assistantContent });

      if (res.text.trim()) {
        await this.whatsapp.sendText(phone, res.text);
        replies.push(res.text);
      }

      if (res.stopReason !== "tool_use" || res.toolUses.length === 0) break;

      const ctx: ToolContext = {
        session,
        store: this.store,
        orders: this.orders,
        whatsapp: this.whatsapp,
        staffChatId: this.config.staffChatId,
        qrImagePath: this.config.qrImagePath,
      };

      const toolResults: any[] = [];
      for (const tu of res.toolUses) {
        const { result, confirmedOrderId } = await runTool(tu.name, tu.input, ctx);
        if (confirmedOrderId) {
          session.lastOrderId = confirmedOrderId;
          const order = await this.orders.getById(confirmedOrderId);
          if (order && order.status === "pending_review") await this.notifyStaffPendingReview(order);
        }
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
      }
      session.history.push({ role: "user", content: toolResults });
      this.store.save(session);
    }

    this.store.save(session);
    return replies;
  }

  async handleImage(phone: string, mediaId: string): Promise<void> {
    const session = this.store.get(phone);
    const orderId = session.lastOrderId;
    if (!orderId) {
      await this.whatsapp.sendText(
        phone,
        "Recibimos tu imagen, pero primero necesitamos cerrar el pedido. ¿Qué te gustaría pedir? 🍗",
      );
      return;
    }
    const { bytes, ext } = await this.whatsapp.downloadMedia(mediaId);
    const path = await this.storage.save(orderId, bytes, ext);
    const order = await this.orders.attachProof(orderId, path);
    await this.whatsapp.sendText(
      phone,
      "¡Gracias! Recibimos tu comprobante. Tu pago queda *en revisión* y te confirmamos apenas lo validemos. 🙌",
    );
    await this.notifyStaffPendingReview(order);
  }

  async notifyStaffPendingReview(order: Order): Promise<void> {
    const items = order.items.map((i) => `  • ${i.quantity} x ${i.name}`).join("\n");
    const method = order.paymentMethod === "transfer" ? "Transferencia (con comprobante)" : "Efectivo contra entrega";
    const summary = [
      `🔔 Pedido #${order.id} PENDIENTE DE REVISIÓN`,
      `Cliente: ${order.customerName} (${order.customerPhone})`,
      `Dirección: ${order.deliveryAddress} (${order.zone})`,
      items,
      `Total: $${order.totalCop.toLocaleString("es-CO")}`,
      `Pago: ${method}`,
      "",
      `Responde: aprobar #${order.id}  /  rechazar #${order.id} <motivo>`,
    ].join("\n");
    await this.whatsapp.sendText(this.config.staffChatId, summary);
    if (order.proofImagePath) {
      await this.whatsapp.sendImage(this.config.staffChatId, order.proofImagePath, `Comprobante #${order.id}`);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/agent/orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite + type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/agent/orchestrator.ts src/agent/orchestrator.test.ts src/bot/botConfig.ts
git commit -m "feat: add conversation orchestrator with tool loop and proof/staff flow"
```

---

## Task 12: Staff control (approve/reject)

**Files:**
- Create: `src/staff/control.ts`
- Test: `src/staff/control.test.ts`

**Interfaces:**
- Consumes: `OrderService` (Task 7); `WhatsAppClient`, `WHATSAPP_CLIENT` (Task 8).
- Produces:
  - `interface StaffCommand { action: "approve" | "reject"; orderId: string; reason?: string }`
  - `parseStaffCommand(text: string): StaffCommand | null` — matches `aprobar #12` / `rechazar #12 motivo` (case-insensitive).
  - `@Injectable() class StaffController` with `constructor(private orders: OrderService, @Inject(WHATSAPP_CLIENT) private whatsapp: WhatsAppClient)` and `handle(text: string, reviewedBy: string): Promise<boolean>` (returns `true` if a command was handled).

- [ ] **Step 1: Write failing test** — `src/staff/control.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseStaffCommand, StaffController } from "./control";
import { OrderService } from "../orders/orderService";
import { MemoryOrderRepository } from "../orders/memoryOrderRepository";
import { FakeWhatsAppClient } from "../whatsapp/client";
import type { OrderDraft } from "../domain/order";

function draft(): OrderDraft {
  return {
    items: [{ productId: "wings_12", name: "12 alitas BBQ", quantity: 1, unitPriceCop: 32000 }],
    customerName: "Ana", deliveryAddress: "Cra 70", zone: "laureles", deliveryFeeCop: 5000,
  };
}

describe("parseStaffCommand", () => {
  it("parses approve", () => {
    expect(parseStaffCommand("aprobar #12")).toEqual({ action: "approve", orderId: "12" });
  });
  it("parses reject with reason", () => {
    expect(parseStaffCommand("rechazar #7 sin cobertura")).toEqual({ action: "reject", orderId: "7", reason: "sin cobertura" });
  });
  it("returns null for non-commands", () => {
    expect(parseStaffCommand("hola equipo")).toBeNull();
  });
});

describe("StaffController.handle", () => {
  it("approves an order and notifies the customer", async () => {
    const repo = new MemoryOrderRepository();
    const orders = new OrderService(repo);
    const wa = new FakeWhatsAppClient();
    const order = await orders.confirm("57300", draft(), "cash"); // pending_review
    const ctrl = new StaffController(orders, wa);

    const handled = await ctrl.handle(`aprobar #${order.id}`, "cocina");
    expect(handled).toBe(true);
    expect((await repo.findById(order.id))?.status).toBe("approved");
    expect(wa.sent.some((m) => m.to === "57300" && m.kind === "text")).toBe(true);
  });

  it("rejects and includes the reason to the customer", async () => {
    const repo = new MemoryOrderRepository();
    const orders = new OrderService(repo);
    const wa = new FakeWhatsAppClient();
    const order = await orders.confirm("57300", draft(), "cash");
    const ctrl = new StaffController(orders, wa);

    await ctrl.handle(`rechazar #${order.id} pago no recibido`, "cocina");
    expect((await repo.findById(order.id))?.status).toBe("rejected");
    const msg = wa.sent.find((m) => m.to === "57300");
    expect(msg && msg.kind === "text" && msg.text.includes("pago no recibido")).toBe(true);
  });

  it("returns false for a non-command", async () => {
    const ctrl = new StaffController(new OrderService(new MemoryOrderRepository()), new FakeWhatsAppClient());
    expect(await ctrl.handle("buenas", "cocina")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/staff/control.test.ts`
Expected: FAIL — cannot find module `./control`.

- [ ] **Step 3: Write `src/staff/control.ts`**

```ts
import { Inject, Injectable } from "@nestjs/common";
import { OrderService } from "../orders/orderService";
import { WHATSAPP_CLIENT, type WhatsAppClient } from "../whatsapp/client";

export interface StaffCommand {
  action: "approve" | "reject";
  orderId: string;
  reason?: string;
}

const RE = /^(aprobar|rechazar)\s+#?(\w+)\s*(.*)$/i;

export function parseStaffCommand(text: string): StaffCommand | null {
  const m = RE.exec(text.trim());
  if (!m) return null;
  const action = m[1].toLowerCase() === "aprobar" ? "approve" : "reject";
  const orderId = m[2];
  const reason = m[3].trim();
  return { action, orderId, ...(reason ? { reason } : {}) };
}

@Injectable()
export class StaffController {
  constructor(
    private orders: OrderService,
    @Inject(WHATSAPP_CLIENT) private whatsapp: WhatsAppClient,
  ) {}

  async handle(text: string, reviewedBy: string): Promise<boolean> {
    const cmd = parseStaffCommand(text);
    if (!cmd) return false;

    if (cmd.action === "approve") {
      const order = await this.orders.review(cmd.orderId, "approved", reviewedBy);
      await this.whatsapp.sendText(
        order.customerPhone,
        `¡Buenas noticias! Tu pedido #${order.id} fue confirmado y ya está en preparación. 🍗 Pronto llega a ${order.deliveryAddress}.`,
      );
    } else {
      const order = await this.orders.review(cmd.orderId, "rejected", reviewedBy);
      const reason = cmd.reason ? ` Motivo: ${cmd.reason}.` : "";
      await this.whatsapp.sendText(
        order.customerPhone,
        `Lo sentimos, tu pedido #${order.id} no pudo confirmarse.${reason} Si crees que es un error, escríbenos.`,
      );
    }
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/staff/control.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/staff
git commit -m "feat: add staff approve/reject command handling"
```

---

## Task 13: Webhook controller + AppModule + bootstrap

**Files:**
- Create: `src/bot/webhook.controller.ts`, `src/app.module.ts`, `src/main.ts`
- Test: `src/bot/webhook.controller.test.ts`

**Interfaces:**
- Consumes: `parseWebhook`, `InboundMessage` (Task 8); `Orchestrator` (Task 11); `StaffController` (Task 12); `BOT_CONFIG`, `BotConfig` (Task 11); `env` (Task 1); all tokens and impls from prior tasks.
- Produces:
  - `@Controller() class WebhookController` with:
    - `constructor(orchestrator: Orchestrator, staff: StaffController, @Inject(BOT_CONFIG) config: BotConfig, @Inject(VERIFY_TOKEN) verifyToken: string)` — the controller does NOT import `env`; the verify token is injected (provided from `getEnv().WHATSAPP_VERIFY_TOKEN` in AppModule). Holds a private `seen = new Set<string>()`.
    - `@Get("health") health()` → `{ ok: true }`.
    - `@Get("webhook") verify(@Query() q, @Res() res)` — Meta verification handshake; echoes `hub.challenge` when the token matches, else 403.
    - `@Post("webhook") receive(@Body() body)` — parses messages; routes staff-chat messages to `StaffController`, customer messages to `Orchestrator`; dedupes by `messageId`; always returns `{ received: true }`.
  - `class AppModule` wiring providers (tokens → impls) and the controller.
  - `main.ts` bootstrap (imports `reflect-metadata`, `NestFactory.create(AppModule)`, `listen(env.PORT)`).

- [ ] **Step 1: Write failing test** — `src/bot/webhook.controller.test.ts` (tests the controller class directly — no HTTP server needed)

```ts
import { describe, it, expect, vi } from "vitest";
import { WebhookController } from "./webhook.controller";
import type { BotConfig } from "./botConfig";

function make(over: { verifyToken?: string } = {}) {
  const orchestrator = { handleText: vi.fn(async () => []), handleImage: vi.fn(async () => {}) };
  const staff = { handle: vi.fn(async () => false) };
  const config: BotConfig = { staffChatId: "staff-1", qrImagePath: "/qr.png", now: () => new Date() };
  const ctrl = new WebhookController(
    orchestrator as any,
    staff as any,
    config,
    over.verifyToken ?? "verify-me",
  );
  return { ctrl, orchestrator, staff };
}

function res() {
  const r: any = {};
  r.status = vi.fn(() => r);
  r.send = vi.fn(() => r);
  return r;
}

describe("GET /webhook verification", () => {
  it("echoes the challenge when the token matches", () => {
    const { ctrl } = make();
    const r = res();
    ctrl.verify({ "hub.verify_token": "verify-me", "hub.challenge": "12345" }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.send).toHaveBeenCalledWith("12345");
  });

  it("rejects a wrong token", () => {
    const { ctrl } = make();
    const r = res();
    ctrl.verify({ "hub.verify_token": "nope", "hub.challenge": "1" }, r);
    expect(r.status).toHaveBeenCalledWith(403);
  });
});

describe("POST /webhook routing", () => {
  const textBody = (from: string, id: string, body: string) => ({
    entry: [{ changes: [{ value: { messages: [{ from, id, type: "text", text: { body } }] } }] }],
  });

  it("routes a customer text to the orchestrator", async () => {
    const { ctrl, orchestrator } = make();
    await ctrl.receive(textBody("57300", "m1", "hola"));
    expect(orchestrator.handleText).toHaveBeenCalledWith("57300", "hola");
  });

  it("routes a staff-chat message to the staff controller", async () => {
    const { ctrl, staff, orchestrator } = make();
    await ctrl.receive(textBody("staff-1", "m2", "aprobar #3"));
    expect(staff.handle).toHaveBeenCalledWith("aprobar #3", "staff-1");
    expect(orchestrator.handleText).not.toHaveBeenCalled();
  });

  it("dedupes repeated message ids", async () => {
    const { ctrl, orchestrator } = make();
    await ctrl.receive(textBody("57300", "dup", "hola"));
    await ctrl.receive(textBody("57300", "dup", "hola"));
    expect(orchestrator.handleText).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bot/webhook.controller.test.ts`
Expected: FAIL — cannot find module `./webhook.controller`.

- [ ] **Step 3: Write `src/bot/webhook.controller.ts`**

```ts
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
```

Note for the test: the controller's constructor takes `verifyToken` as its 4th positional arg with NO default (the test passes it directly as `"verify-me"`). In production it is provided via the `VERIFY_TOKEN` token (Step 4). The controller does NOT import `env` — this keeps `webhook.controller.test.ts` free of the env module's runtime validation.

- [ ] **Step 4: Write `src/app.module.ts`**

```ts
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
```

- [ ] **Step 5: Write `src/main.ts`**

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { getEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(getEnv().PORT, "0.0.0.0");
}

bootstrap();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/bot/webhook.controller.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full suite + type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors. (If `@prisma/client` types are missing, run `npx prisma generate` first.)

- [ ] **Step 8: Commit**

```bash
git add src/bot/webhook.controller.ts src/bot/webhook.controller.test.ts src/app.module.ts src/main.ts
git commit -m "feat: add webhook controller, AppModule wiring, and bootstrap"
```

---

## Task 14: End-to-end happy-path test + manual verification

**Files:**
- Create: `src/e2e.test.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: `WebhookController` (Task 13), `Orchestrator`, `StaffController`, and all fakes; a scripted `LlmClient`. Wired by direct instantiation (no Nest DI container).

- [ ] **Step 1: Write the E2E test** — `src/e2e.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { WebhookController } from "./bot/webhook.controller";
import { Orchestrator } from "./agent/orchestrator";
import { StaffController } from "./staff/control";
import { MemorySessionStore } from "./sessions/sessionStore";
import { OrderService } from "./orders/orderService";
import { MemoryOrderRepository } from "./orders/memoryOrderRepository";
import { FakeWhatsAppClient } from "./whatsapp/client";
import { MemoryProofStorage } from "./storage/memoryProofStorage";
import type { BotConfig } from "./bot/botConfig";
import type { LlmClient, LlmResponse } from "./agent/llmClient";

class ScriptedLlm implements LlmClient {
  constructor(private script: LlmResponse[]) {}
  async complete(): Promise<LlmResponse> {
    return this.script.shift() ?? { text: "¿Algo más?", toolUses: [], stopReason: "end" };
  }
}

const textBody = (from: string, id: string, body: string) => ({
  entry: [{ changes: [{ value: { messages: [{ from, id, type: "text", text: { body } }] } }] }],
});
const imageBody = (from: string, id: string, mediaId: string) => ({
  entry: [{ changes: [{ value: { messages: [{ from, id, type: "image", image: { id: mediaId } }] } }] }],
});

describe("E2E happy path (transfer)", () => {
  it("takes an order, receives proof, staff approves, customer notified", async () => {
    const repo = new MemoryOrderRepository();
    const orders = new OrderService(repo);
    const wa = new FakeWhatsAppClient();
    const config: BotConfig = {
      staffChatId: "staff-1", qrImagePath: "/qr.png",
      now: () => new Date(2026, 6, 9, 19, 0),
    };

    const llm = new ScriptedLlm([
      { text: "", toolUses: [{ id: "1", name: "add_item", input: { productId: "wings_12", quantity: 1 } }], stopReason: "tool_use" },
      { text: "", toolUses: [{ id: "2", name: "set_customer_details", input: { name: "Ana", address: "Cra 70", neighborhood: "Laureles" } }], stopReason: "tool_use" },
      { text: "", toolUses: [{ id: "3", name: "confirm_order", input: { paymentMethod: "transfer" } }], stopReason: "tool_use" },
      { text: "", toolUses: [{ id: "4", name: "send_qr", input: {} }], stopReason: "tool_use" },
      { text: "Listo Ana, escanea el QR y envíame el comprobante. 🍗", toolUses: [], stopReason: "end" },
    ]);

    const orchestrator = new Orchestrator(
      llm, new MemorySessionStore(), orders, wa, new MemoryProofStorage(), config,
    );
    const staff = new StaffController(orders, wa);
    const ctrl = new WebhookController(orchestrator, staff, config, "verify-me");

    await ctrl.receive(textBody("57300", "c1", "Quiero 12 alitas para Laureles, soy Ana, Cra 70, pago por transferencia"));
    const created = await repo.findById("1");
    expect(created?.status).toBe("awaiting_payment");
    expect(wa.sent.some((m) => m.kind === "image" && m.imagePath === "/qr.png")).toBe(true);

    await ctrl.receive(imageBody("57300", "c2", "media-9"));
    expect((await repo.findById("1"))?.status).toBe("pending_review");
    expect(wa.sent.some((m) => m.to === "staff-1")).toBe(true);

    await ctrl.receive(textBody("staff-1", "s1", "aprobar #1"));
    expect((await repo.findById("1"))?.status).toBe("approved");
    expect(wa.sent.some((m) => m.to === "57300" && m.kind === "text" && m.text.includes("preparación"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `npx vitest run src/e2e.test.ts`
Expected: PASS — full transfer flow verified with fakes.

- [ ] **Step 3: Write `README.md`**

```markdown
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
```

- [ ] **Step 4: Run full suite + type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/e2e.test.ts README.md
git commit -m "test: add end-to-end happy-path test and README with manual verification"
```

---

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
```


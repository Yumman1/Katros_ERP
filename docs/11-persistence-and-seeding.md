# 11 — Persistence and Seeding

> **Update (Supabase migration):** the mock JSON/`globalThis` runtime described below has been fully replaced by Supabase PostgreSQL via Prisma — every store in `server/` now reads/writes relational tables (see [12-supabase-vercel-deployment.md](./12-supabase-vercel-deployment.md) and `prisma/schema.prisma`). This document is kept for domain reference; ignore its persistence mechanics.


---

## Environment

| Variable | Effect |
|----------|--------|
| `MOCK_MODE` / `SKIP_DATABASE` | When true/1: skip Prisma for auth demo users; use mock stores |
| `LOCAL_PERSIST` | `false` disables disk; default true in mock mode |
| `LOCAL_DATA_DIR` | Override directory (default `{cwd}/data/local`) |
| `DATABASE_URL` | PostgreSQL for Prisma mode |
| `NEXTAUTH_SECRET` | Required for JWT |
| `NEXTAUTH_URL` | App base URL |

Detection: `server/mock-mode.ts`, `server/local-persist.ts`.

---

## JSON files

All under `data/local/` (created automatically).

| File | Written by | Contents |
|------|------------|----------|
| booked-trades.json | dummy-data.ts | `{ mockTradeSeq, bookedTrades[] }` |
| execution-state.json | execution/runtime.ts | contracts, receipts, dispatches, spot, payments, trucks, seq counters |
| master-data.json | trader-master-data.ts | commodities, counterparties, locations, units, warehouse overrides |
| change-requests.json | change-requests-store.ts | `{ requests[], seq }` |
| market-prices.json | market-prices.ts | `{ prices: Record<code, StoredMarketPrice> }` |
| position-adjustments.json | position-ledger.ts | `{ byCommodity: Record<code, deltaMt> }` |

### Serialization

- Library: **superjson** (`local-persist.ts`)
- Write: temp file + atomic rename
- Read: parse on startup into `globalThis` runtime
- Dev: multi-worker sync via mtime check on read (`syncFromDisk`)

---

## Example: booked-trades.json (minimal)

```json
{
  "json": {
    "mockTradeSeq": 10005,
    "bookedTrades": [
      {
        "tradeRef": "KAS-2026-10001",
        "tradeStatus": "PENDING",
        "submittedToExecution": true,
        "quantity": 300,
        "quantityUnit": "MT",
        "direction": "BUY",
        "tradeParams": { "quantityTolerance": "+/- 10 MT" }
      }
    ]
  },
  "meta": { "values": { "...": ["Date"] } }
}
```

(superjson wraps values with date metadata — use `readPersisted`/`writePersisted`, do not hand-edit without understanding meta.)

---

## Example: execution-state.json structure

```typescript
{
  contracts: [["KAS-2026-10001", { tradeRef, contractualQtyMt, receivedQtyMt, ... }]],
  inboundReceipts: [],
  outboundDispatches: [],
  spotEvents: [["KAS-2026-10002", { state: "CONTRACT", ... }]],
  paymentRequests: [],
  pendingTrucks: [{ gatepassNo, movementType, status: "PENDING", ... }],
  inboundSeq: 1,
  outboundSeq: 1,
  paymentSeq: 1,
  truckSeq: 1,
  gateInvoiceSeq: 1
}
```

---

## Gatepass documents

Path: `data/local/gatepass-docs/{gatepassNo}/`  
Module: `server/gatepass-documents.ts`  
Stores uploaded PDFs/images from public gatepass form.

---

## Scripts

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run data:reset` | `scripts/data-reset.ts` | Wipe all local JSON |
| `npm run db:seed` | `prisma/seed.ts` | PostgreSQL seed users + reference |
| `npm run db:migrate` | prisma migrate deploy | Apply migrations |
| `npm run db:push` | prisma db push | Schema sync dev |
| `npm run db:reset` | prisma migrate reset | DB wipe + seed |

Reset module: `server/reset-local-data.ts` — deletes known JSON files.

Warehouse seed: `scripts/seed-kastros-warehouses.ts` — populates master-data.json.

Brand assets: `scripts/copy-brand-assets.mjs` (pre-dev).

---

## Mock credentials

`server/dummy-data.ts` → `mockCredentialsUser(email)`:

- Password: `demo` or `Kastros123!`
- Role inferred from email (trader@, execution@, ceo@, finance@, admin@, etc.)
- `isHead`: email contains `head` or `lead`, or ADMIN role

---

## Running modes

### Mock-only (default dev)

```bash
MOCK_MODE=true npm run dev
```

No PostgreSQL required. All trader/execution flows functional.

### Full PostgreSQL

```bash
DATABASE_URL=postgresql://... MOCK_MODE=false npm run dev
npm run db:migrate
npm run db:seed
```

Dashboard analytics routers use Prisma; verify trader/execution still mock-backed unless wired.

---

## globalThis runtime keys

| Key | Module |
|-----|--------|
| `__kastrosBookedRuntime` | dummy-data.ts |
| `__kastrosMasterRuntime` | trader-master-data.ts |
| `__kastrosExecutionRuntime` | execution/runtime.ts |
| `__kastrosChangeRequests` | change-requests-store.ts |
| `__kastrosMarketPriceStore` | market-prices.ts |

---

## Backup / restore

Copy entire `data/local/` directory to backup state.  
Restore: stop server, replace files, restart (runtime reloads from disk).

---

## Related

- [01-architecture.md](./01-architecture.md)
- [02-data-model.md](./02-data-model.md)
- [LOCAL_STORAGE_SETUP.md](../LOCAL_STORAGE_SETUP.md) — legacy execution notes

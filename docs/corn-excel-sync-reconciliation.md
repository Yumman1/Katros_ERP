# Corn Excel Sync — Reconciliation Report (17 Aug 2026)

Live Supabase project reconciled against:

- `Corn Summer - Purchase (2).xlsx` — Purchase Trade + Inbound Details
- `Corn Summer 26 Execution.xlsx` — Sale Contract + Outbound

Applied via [`scripts/imports/04-corn-summer-excel-reconciliation.sql`](../scripts/imports/04-corn-summer-excel-reconciliation.sql) and verified with net-position logic.

---

## Executive summary

All **70 purchase trades** are now **Closed** in the system (0 MT open purchases). The missing **KCS-424** receipt (+24.785 MT) for `Kas-Cor26-0067` was inserted. Sales match the **Execution Excel** (160 MT open). Corn Winter external transfers total **105 MT**, matching the position screenshot.

---

## Position after sync (live system)

| Column | Corn Summer | Corn Winter |
|--------|-------------|-------------|
| Open Purchases | **0.00 MT** | 0 |
| Inventory | **7,889.65 MT** | **105.00 MT** |
| Open Sales | **160.00 MT** | 0 |
| **Net Position** | **7,729.65 MT** | **105.00 MT** |

Inventory (Summer) = Σ buy inbound − Σ sell outbound = **7,991.04 − 101.39 = 7,889.65 MT**

Open sales = `KAS-2026-75` (100 MT) only. `KAS-COR27-SAL-0003` (60 MT) was removed — not booked in the system.

---

## Comparison vs position screenshot (17 Aug)

| Row | Screenshot | System (after sync) | Explanation |
|-----|------------|---------------------|-------------|
| Open Purchases | 0 | **0** | Aligned — 0066/0067 closed |
| Inventory | 7,891 | **7,889.65** | Within **~1.4 MT** — workbook gross inbound rounds to 7,991.4 MT; small receipt-level rounding |
| Open Sales | **100** | **160** | **Intentional** — you chose to match the **Execution Excel**, which includes **SAL-0003 (60 MT open)** not shown in the screenshot |
| Net | **7,791** | **7,729.65** | **61.4 MT lower** than screenshot: **60 MT** extra open sale (SAL-0003) + **~1.4 MT** inventory rounding |
| Trade Entry Rate | 2,430 | ~2,434 | Contractual-qty weighting on closed trades; ~₨4 gap vs workbook (cancelled rows / rounding) |
| Market / FX | 2,600 / 277.6605 | **2,600 Summer · 2,350 Winter** (Daily Prices per season) | Season-specific Daily Prices now supported; update FX via Positions fallback |

### Corn Winter

| Metric | Screenshot | System | Notes |
|--------|------------|--------|-------|
| Inventory / Net | 105 | **105.00** | Adjusted `SHF-00004` received qty **28.375 → 32.105 MT** (+3.73 MT) so five Kisan Godam transfers sum to 105 |

---

## Trades touched

### Purchases

| Trade | Change |
|-------|--------|
| `Kas-Cor26-0066` | Contractual qty **150 → 104 MT**; closed (EXECUTED / Close) |
| `Kas-Cor26-0067` | Inserted **KCS-424** (24.785 MT); received **189.055 MT**; closed |
| All other `Kas-Cor26-*` | Stale `openQtyMt` zeroed on already-closed contracts (**28 rows**) |

### Sales

| Excel ref | System ref | Change |
|-----------|------------|--------|
| KAS-COR27-SAL-0001 | `KAS-2026-73` | Closed — 101.39 MT executed |
| KAS-COR27-SAL-0002 | `KAS-2026-75` | Counterparty → **ISHAQ AND SONS**; rate **2700**; 100 MT open |
| KAS-COR27-SAL-0003 | — | **Not in system** (removed; Excel row skipped) |

---

## Inbound gap resolved (0067)

Excel Inbound Details listed **9 KCS rows** totalling **189.055 MT**. The system had **8 rows** (164.27 MT). Missing row:

| KCS | Truck | MT | Status (Excel) |
|-----|-------|-----|----------------|
| KCS-424 | CAG-7740 | 24.785 | FWD to Sufyan |

---

---

## Payment / invoice approval sync (17 Aug 2026)

Contract **Close** and gate-invoice **payment approval** are independent. After bulk import + trade close reconciliation, **7 trucks** still appeared on the trader invoice-approvals queue despite Excel showing payment already cleared or correctly held.

Applied via [`scripts/imports/05-corn-summer-payment-reconciliation.sql`](../scripts/imports/05-corn-summer-payment-reconciliation.sql) and [`scripts/lib/excel-inbound-payment.ts`](../scripts/lib/excel-inbound-payment.ts).

### Excel Inbound Details status → DB storage

| Excel status (col K) | `gateInvoiceStage` | `paidAmountPkr` | `InboundReceipt.status` | Trader buy approvals |
|----------------------|-------------------|-----------------|---------------------------|----------------------|
| Payment Release | `PAYMENT_APPROVED` | full `amountDue` | `PAID` | Hidden |
| 1M / 1.1M / 1278000 hold + Remaining Released | `PARTIAL_PAYMENT` | pro-rata released share | `PARTIALLY_PAID` | **Visible** (remainder stuck) |
| Hold (full) | `HOLD_OLD_DUES` | `0` | `ALLOCATED` | On-hold tab only |
| DN - Short (KCS-323) | `PAYMENT_APPROVED` | full (treated as cleared) | `PAID` | Hidden |
| Shifting / FWD to Sufyan | — | `0` | `ALLOCATED` | Hidden |

Historical imports settle on **receipt PAID + gatepass DEBIT** — no buy-side PAYMENT credits ([`scripts/imports/README.md`](../scripts/imports/README.md)).

### Rows fixed (Payment Release stuck in queue)

| KCS | Gatepass | Was | Now |
|-----|----------|-----|-----|
| KCS-417 | GP-IN-0411 | `PENDING_TRADE_APPROVAL` | `PAID` / `PAYMENT_APPROVED` |
| KCS-419 | GP-IN-0413 | `PENDING_TRADE_APPROVAL` | `PAID` / `PAYMENT_APPROVED` |
| KCS-420 | GP-IN-0414 | `PENDING_TRADE_APPROVAL` | `PAID` / `PAYMENT_APPROVED` |
| KCS-418 | GP-IN-0412 | `FINANCE_PENDING` + pending `pay-10` | `PAID` / `PAYMENT_APPROVED` |
| KCS-323 | GP-IN-0280 | `FINANCE_PENDING` + pending `pay-3` | `PAID` / `PAYMENT_APPROVED` |

### Left intentionally in queue (Excel shows remainder held)

| Invoice | Trade | Trucks | Excel status |
|---------|-------|--------|--------------|
| 18 | Kas-Cor26-0066 | KCS-406, KCS-407 | 1M Hold / Payment Released |
| 21 | Kas-Cor26-0058 | KCS-393, KCS-397 | 1278000 Debit note - Remaining Released |

### Post-sync expected counts

| Check | Expected |
|-------|----------|
| `PENDING_TRADE_APPROVAL` trucks | **0** |
| `PARTIAL_PAYMENT` trucks | **4** |
| Inbound `FINANCE_PENDING` | **0** |
| Trader buy approval badge | **0** (partials show under "Part paid" only) |

### Tools

- `npx tsx scripts/reconcile-corn-from-excel.ts --report` — payment mismatches vs Excel
- `npx tsx scripts/reconcile-corn-from-excel.ts --apply` — trade + payment fixes when DB URL configured

---

## Tools (trade sync)

- [`scripts/reconcile-corn-from-excel.ts`](../scripts/reconcile-corn-from-excel.ts) — parse workbooks, emit manifest JSON; `--apply` when `POSTGRES_PRISMA_URL` is configured
- [`scripts/imports/04-corn-summer-excel-reconciliation.sql`](../scripts/imports/04-corn-summer-excel-reconciliation.sql) — idempotent SQL replay of the trade sync

---

## If you need the screenshot net (7,791) instead of Excel net (7,730)

The screenshot predates or excludes **SAL-0003 (60 MT)**. To match the picture’s **100 MT open sales** and **7,791 net**, either:

Corn Summer open sales are **100 MT** (`KAS-2026-75`), matching the position screenshot. Excel SAL-0003 (60 MT) is not booked in the system.

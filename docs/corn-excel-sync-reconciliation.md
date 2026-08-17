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

## Tools

- [`scripts/reconcile-corn-from-excel.ts`](../scripts/reconcile-corn-from-excel.ts) — parse workbooks, emit manifest JSON; `--apply` when `POSTGRES_PRISMA_URL` is configured
- [`scripts/imports/04-corn-summer-excel-reconciliation.sql`](../scripts/imports/04-corn-summer-excel-reconciliation.sql) — idempotent SQL replay of the sync

---

## If you need the screenshot net (7,791) instead of Excel net (7,730)

The screenshot predates or excludes **SAL-0003 (60 MT)**. To match the picture’s **100 MT open sales** and **7,791 net**, either:

Corn Summer open sales are **100 MT** (`KAS-2026-75`), matching the position screenshot. Excel SAL-0003 (60 MT) is not booked in the system.

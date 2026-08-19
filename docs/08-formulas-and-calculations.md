# 08 — Formulas and Calculations

All business math with defaults, thresholds, and source files.

---

## 1. Contract closure

**File:** `lib/contract-closure.ts`  
**Used by:** `server/execution/contracts.ts`, `server/routers/trader.ts`

### Constants

| Name | Value |
|------|-------|
| `DEFAULT_QUANTITY_TOLERANCE_MT` | 10 MT |
| `AUTO_CLOSE_THRESHOLD_MT` | 10 (deprecated alias) |

### parseQuantityToleranceMt(contractualQtyMt, quantityUnit, tradeParams?)

Resolution order:

1. **String label** from `tradeParams.quantityTolerance` or legacy `tradeParams.tolerancePct`:
   - Absolute: regex `/\+?\/?-?\s*([\d.]+)\s*(MT|KG|MAUND|T|TON|TONNE)/i` → return parsed MT
   - Percent: regex `/([\d.]+)\s*%/` → `(contractualQtyMt × pct) / 100`

2. **Structured:** `quantityToleranceMode` + `quantityToleranceValue`:
   - `mode === "quantity"` → return value as MT
   - else (percent) → `(contractualQtyMt × n) / 100`

3. **Fallback** → `DEFAULT_QUANTITY_TOLERANCE_MT` (10)

**UI:** `components/trader/quantity-tolerance-field.tsx` — default mode **percent**, saved as `+/- {n}%` or `+/- {n} {unit}` in `tradeParams.quantityTolerance`.

### Auto-close

```
autoCloseThresholdQty = contractualQtyMt + toleranceMt

shouldAutoCloseContract =
  receivedQtyMt > autoCloseThresholdQty   // strict greater-than
```

**Example:** 300 MT contract + 10 MT tolerance → auto-close only when **received > 310 MT**.

Manual close: trader fulfillment → `team.submitChangeRequest` (CLOSE) → CEO approval → `closeLockedContract`.

---

## 2. Fulfillment quantity

**File:** `server/execution/contracts.ts` — `getFulfilledQtyForTrade()`

### BUY

```
fulfilled = Σ inboundReceipts (status ≠ DRAFT).allocatedQtyMt
          + spotReceiveQty   // if spot state === RECEIVED

spotReceiveQty = kgToQuantityUnit(spot.warehouseReceiveWeightKg, quantityUnit)
```

### SELL

```
fulfilled = Σ outboundDispatches (status ≠ AT_GATE).allocatedQtyMt
```

### Derived

```
openQtyMt = max(0, contractualQtyMt − fulfilled)
fulfillmentPct = fulfilled / contractualQtyMt   // UI
```

On `refreshContract`: if `shouldAutoCloseContract` → `contractStatus = "Close"`, `tradeStatus = EXECUTED`.

### Outbound assignment absorbable qty

**File:** `lib/contract-closure.ts` — `warehouseAbsorbableQtyMt()`  
**Used by:** `server/execution/trucks.ts` (outbound `assignTruckToTrade`), contract views, execution UI

Outbound sale trucks may split across trades, but each assignment caps at **absorbable** qty (not strict open):

```
contractHeadroom = max(0, (contractualQtyMt + toleranceMt) − contractFulfilledMt)
whHeadroom       = max(0, (whAllocatedMt + toleranceMt) − whFulfilledMt)
absorbableMt     = min(contractHeadroom, whHeadroom)
```

Assignment allocates `min(truckRemainingKg, absorbableKg)`. Leftover weight stays on the truck (`PARTIAL`) for the next trade.

The absorbable ceiling matches the auto-close threshold: a trade auto-closes only when **fulfilled > contractual + tolerance** (strict `>`), so deliveries within tolerance stay Open until manually closed.

**Example:** 100 MT contract + 10 MT tolerance, 50.505 MT already dispatched, 50.885 MT truck → full truck accepted (101.39 MT total), trade stays Open.

---

## 3. Price units and notional

**Files:** `lib/price-units.ts`, `lib/unit-registry.ts`, `server/dummy-data.ts`

### Currency to base

| Currency | Base | Factor |
|----------|------|--------|
| PKR | PKR | 1 |
| USD | USD | 1 |
| USd (cents) | USD | 0.01 |

### Default kg per unit (`DEFAULT_KG_PER_UNIT`)

| Unit | kg |
|------|-----|
| MT, TON, TONNE | 1000 |
| KG | 1 |
| MAUND_40, MAUND | 40 |
| MAUND_37 | 37.324 |
| LB | 0.45359237 |
| CWT | 45.359237 |
| Unknown | 1000 (fallback) |

### Price normalization

```
pricePerCanonical =
  price × currencyToBaseFactor(currency) × (canonicalKgPerUnit / basis.kgPerUnit)
```

Canonical quantity unit: **MT** (1000 kg). `canonicalKgPerUnit` from commodity or default 1000.

### Booking notional

```
quantityMt = toMt(qtyEntered, qtyEnteredUnit)
pricePerCanonicalQty = toPricePerCanonicalQty(quotedPrice, priceMetric, canonicalKgPerUnit)

notional = quantityMt × pricePerCanonicalQty

qtyKg = quantityMt × canonicalKgPerUnit
priceDenomCount = qtyKg / priceKgPerUnit
commissionTotalQuoted = commissionPerUnit × priceDenomCount
commissionInBase = commissionTotalQuoted × currencyToBaseFactor(priceCurrency)
netAfterCommission = max(0, notional − commissionInBase)
```

### Locked rate derivations (`contracts.ts`)

```
ratePerKg = pricePerCanonicalQty / defaultKgPerUnit(quantityUnit)
         OR ratePerMaund / KG_PER_MAUND_40
         OR price / 1000
```

---

## 4. Unit registry

**File:** `lib/unit-registry.ts`

```
toKg(qty, unit) = qty × kgPerUnitOf(unit)
kgToMt(kg) = kg / 1000
toMt(qty, unit) = kgToMt(toKg(qty, unit))
mtToUnit(mt, unit) = (mt × 1000) / kgPerUnitOf(unit)
```

Custom units merged via `mergeUnitRegistry(customUnits)` — custom overrides built-in on same code.

### Open quantity epsilon (`lib/unit-conversion.ts`)

| Unit | Epsilon |
|------|---------|
| KG | 0.5 |
| MAUND*, MAUND_40, MAUND_37 | 0.001 |
| Others | 0.001 |

Used in `allocationsSumMatchesContract`.

---

## 5. Warehouse allocation

**File:** `lib/warehouse-allocation.ts`

```
allocationQtyAtWarehouse = sum(qtyMt) for warehouse
openQtyAtWarehouse = max(0, allocatedQty − fulfilledQty)
warehouseShareOfOrder = (qtyMt / contractualQtyMt) × 100
allocationsSumMatchesContract = |sumQty − contractualQty| ≤ openQtyEpsilon(unit)
```

**Serialization:**
- Trader: `warehouseSelections` = `"WH A|WH B"`
- Execution split: `executionWarehouseSplit` = `"WH A:500|WH B:300"`

**Lock validation:** Required for `PURCHASE_DELIVERED` and `SALE_EX_WAREHOUSE`. Split must sum to **full contract qty**. Requires `warehouseSplitApproved === true`.

---

## 6. Warehouse costing

**File:** `lib/warehouse-costing.ts`

Constants: `KG_PER_MAUND = 40`, `MAUND_PER_MT = 25`, default `grainDivisionSqFt = 7`.

```
totalRentCostPkr = squareFeet × rentalPerSqFtMonth + rentalTaxPkr
totalLaborCostPkr = Σ (headcount × unitCostPkr)
totalRunningCostPkr = totalRentCostPkr + totalLaborCostPkr
managementFeePkr = totalRunningCostPkr × (managementFeePct / 100)
totalCostPkr = totalRunningCostPkr + managementFeePkr
loadedCostPerSqFtPkr = totalCostPkr / squareFeet

storageCapacityMt = squareFeet / grainDivisionSqFt
storageAt70PctMt = storageCapacityMt × 0.7
maundsAt100 = storageCapacityMt × MAUND_PER_MT
maundsAt70 = storageAt70PctMt × MAUND_PER_MT
costPerMaundAt100PctPkr = totalCostPkr / maundsAt100
costPerMaundAt70PctPkr = totalCostPkr / maundsAt70
```

Default labor (PKR/month): Supervisor 60k, Asst 40k, Security×4 52.2k each.

---

## 7. Warehouse utilization

**File:** `lib/warehouse-utilization.ts`

Defaults: `grainDivisionSqFt = 7`, `balesDivisionSqFt = 4.5`

```
estimatedCapacityMt = round(capacitySqFt / grainDivisionSqFt / 10) × 10
estimatedCapacityBales = ceil((capacitySqFt / balesDivisionSqFt) / 10) × 10

consumedSqFt = (stockMt × grainDivisionSqFt) + (stockBales × balesDivisionSqFt)
remainingSqFt = max(capacitySqFt − consumedSqFt, 0)
utilizationPct = min(consumedSqFt / capacitySqFt, 1.5)   // cap 150%

baleEquivalentMt = (stockBales × balesDivisionSqFt) / grainDivisionSqFt
balanceMt = max(0, theoreticalMaxMt − stockMt − baleEquivalentMt)

divisionAvailabilityPct = round(max(0, available / theoreticalMax × 100), 1)
availabilityPct = round(max(0, 100 − utilizationPct×100), 1)
```

**Tone thresholds** (`lib/warehouse-availability.ts`): High ≥ 30%, Medium ≥ 10%, Low < 10%.

**Storage division:** Bale if unit BALE/BAG or codes CTN, COT, COTTON, AFC; grain if category GRAINS/OILSEEDS or grain codes.

---

## 8. Inventory stock deltas

**File:** `lib/inventory-stock.ts`

| Movement | Status | Delta |
|----------|--------|-------|
| Inbound | DRAFT | 0 |
| Inbound | other | +allocatedQtyMt |
| Outbound | AT_GATE | 0 |
| Outbound | WEIGHED, FINANCE_PENDING, RELEASED | −allocatedQtyMt |

Pending truck (unassigned): `pendingQtyMt = kgToQuantityUnit(remainingKg, unit)`.

---

## 9. Position ledger

**File:** `server/position-ledger.ts`

Per commodity:

```
paperLong += openQtyMt   (BUY locked contracts)
paperShort += openQtyMt  (SELL locked contracts)
paperNet = paperLong − paperShort

physicalNet = Σ inboundStockDelta + Σ outboundStockDelta
manualAdjustment = position-adjustments.json byCommodity[code]
adjustedPhysical = physicalNet + manualAdjustment
variance = paperNet − physicalNet
netPosition = paperNet − adjustedPhysical
```

Filter rows where `|paperNet|, |physicalNet|, |manualAdjustment| > 0.001`.

---

## 10. MTM

**File:** `lib/calculations/mtm.ts`

```
bookValue = quantity × bookPrice
marketValue = quantity × marketPrice
mtmPnl = (direction === BUY) ? marketValue − bookValue : bookValue − marketValue
unrealizedPnl = mtmPnl
```

**Mock trade preview** (`server/dummy-data.ts`):

```
book = quantity × (pricePerCanonicalQty ?? price)
mkt = quantity × marketPrice
mtmPnl = (BUY) ? mkt − book : book − mkt
```

**Day change** (`server/routers/positions.ts`): `(marketPrice − prevClose) / prevClose` if prevClose > 0.

---

## 11. PnL attribution (stub)

**File:** `server/routers/pnl.ts`

```
priceEffect = (price × 0.002) × quantity × sign(BUY=+1, SELL=−1)
volumeEffect = hashSign(tradeRef) × quantity × 0.15
fxEffect (PKR only) = quantity × price × 0.0008
totalPnl = priceEffect + volumeEffect + fxEffect
```

---

## 12. Reconciliation

**File:** `lib/calculations/reconciliation.ts`

```
qtyMatch = |invoiceQty − tradeQty| / tradeQty < 0.001
amtMatch = |invoiceAmount − tradeGross| < 100 PKR
```

---

## 13. FIFO allocation

**File:** `lib/fifo-allocation.ts`

Sort contracts by `contractDate` ascending. Allocate `min(openQtyMt, remaining)` per contract. Open threshold: 0.001 MT.

---

## 14. Delivery window

**File:** `lib/delivery-window.ts`

| Constant | Value |
|----------|-------|
| `DUE_SOON_DAYS` | 5 |

States: `NO_DATES`, `NOT_STARTED`, `IN_WINDOW`, `DUE_SOON`, `OVERDUE`, `FULFILLED`.

---

## 15. Market price change

**File:** `server/market-prices.ts`

```
chgPct = round2(((cnf − yesterday) / yesterday) × 100)
```

Only when CNF and yesterday share same currency and unit.

---

## 16. Spot payment fallback

**File:** `server/execution/payments.ts`

```
amount = invoiceAmount ?? contractualQtyMt × ratePerMaund × KG_PER_MAUND (40)
```

---

## 17. Physical constants (trade-constants)

| Constant | Value |
|----------|-------|
| `KG_PER_MAUND_40` | 40 |
| `KG_PER_MAUND_37` | 37.324 |
| Default moisturePct (corn quality) | 12 |
| Default brokenPct | 0.5 |
| Default foreignMatterPct | 0.5 |

---

## 18. Execution profile routing

**File:** `lib/trade-constants.ts`

```
if direction === SELL → SALE_EX_WAREHOUSE
else if incoterms === "Spot" → PURCHASE_SPOT
else → PURCHASE_DELIVERED
```

See [05-execution-profiles.md](./05-execution-profiles.md).

---

## 19. Net position — quantities, entry rate, market rate

**File:** `server/net-position.ts`  
**UI:** `components/position/net-position-panel.tsx`  
**Daily Prices:** `server/market-prices.ts`, `app/(execution)/execution/prices/page.tsx`

### Quantities (per commodity + season column)

```
Net Position (MT) = Open Purchases + Inventory (At Warehouse) − Open Sales
```

| Row | Source |
|-----|--------|
| Open Purchases | Sum of `openQtyMt` on **Open** BUY `ExecutionContract` rows in that season |
| Inventory | Σ buy inbound receipts − Σ sell outbound dispatches + external `StockTransfer` receipts (`externalOrigin` set) |
| Open Sales | Sum of `openQtyMt` on **Open** SELL contracts in that season |

### Trade entry rate (₨/maund)

Same metric as **Execution → Inventory → Total weighted purchase price**, scoped per commodity + season column:

```
entryRate = Σ (receipt qty × contract rate PKR/MT) / Σ receipt qty
            ─────────────────────────────────────────────────────
                          (for rated BUY inbound only)
```

Contract rate PKR/MT: `ratePerKg × 1000`, else `ratePerMaund × (1000 / 40)`.

Only **BUY** trades in the same season bucket contribute (inbound receipt qty grouped by `tradeRef`). Open paper and commission are not part of this weighting — only physical receipts with a contract rate.

Implementation: `server/inventory-valuation.ts` (shared with the inventory stat card); net position calls it per season via `server/net-position.ts`.

**Corn Winter blank:** Winter inventory is mostly external `StockTransfer` stock with no inbound receipt / contract rate. The UI shows a note instead of a number until winter BUY receipts exist or transfers carry cost.

### Market rate (₨/maund)

Precedence **per commodity + season**:

1. **Daily Prices** — `DeskMarketPrice` row for `(commodityCode, season)`. Corn publishes **Summer** and **Winter** separately.
2. **Desk fallback** — `PositionMarketInput.marketRatePkrPerMaund` for that season (Positions panel “fallback / FX”).
3. Blank — In/(Out) of the money rows show “—”.

Yesterday local is preferred over CNF when normalising to ₨/maund (`lib/desk-mark-price.ts`).

### In/(Out) of the money

```
perMaund = marketRate − tradeEntryRate
valuePkr = perMaund × netPositionMt × (1000 / 40)    // maunds per MT
valueUsd = valuePkr / fxRate
```

FX comes from `PositionMarketInput.fxRate` per season column.

---

## 20. Counterparty ledger totals

**File:** `server/finance/ledger.ts` (`getCounterpartyLedgers`)  
**UI:** `components/ledgers/counterparty-ledgers-panel.tsx`

Every counterparty has two accounts that never mix: **SELL** (receivables) and **BUY** (payables).

### Buy side — the debit follows the money

**No buy debit posts a claim.** An inbound truck bills its expected invoice on assignment and that amount is stored as `CounterpartyLedgerEntry.amountPkr`, but what the row **debits** is only money that has actually moved:

```
billedPkr = CounterpartyLedgerEntry.amountPkr          // the bill / the claim
paidPkr   = min(billedPkr, Σ InboundReceipt.paidAmountPkr for the gatepass)
amountPkr = paidPkr                                    // what hits the debit column
```

Each part-payment finance approves adds to `paidAmountPkr` (`server/execution/payments.ts`), so successive releases raise the **same** row's debit — 0 → part → full — instead of posting a new entry. The row reads *Unpaid*, *Part paid*, then *Paid* once every receipt of the gatepass is `PAID` and the debit equals the invoice.

Account totals:

```
totalBilledPkr      = Σ billedPkr (debits)
totalDebitPkr       = Σ amountPkr (debits)  → money released
outstandingDebitPkr = totalBilledPkr − Σ paidPkr
balancePkr          = totalCreditPkr − totalBilledPkr
```

Payables never age: a purchase is paid outright or deliberately held (`gateInvoiceStage` `PARTIAL_PAYMENT` / `HOLD_OLD_DUES`), and a hold is a decision rather than an overdue bill.

### Settlement notes (DN / CN)

Cancelling or short-closing a trade posts a note on the trade's own account (`server/trade-closure.ts`), side chosen by `settlementNoteEntryType` so the balance always moves the right way:

| Account | DN (settlement above rate) | CN (below rate) |
|---------|---------------------------|-----------------|
| BUY | CREDIT — seller owes us, reduces net payable | DEBIT — we owe the seller |
| SELL | DEBIT — buyer owes us more | CREDIT — we owe the buyer |

A note is a **claim**, `sourceType = ADJUSTMENT` with `noteStatus = UNPAID`, and it settles **in full or not at all** — `createVoucher` rejects a voucher whose amount differs from the note by more than 0.5 PKR. There is no per-receipt payment channel behind it, so unlike a gate invoice it has no partial state to grow through.

It still obeys the same rule on the buy account: a CN debits **nothing** while unpaid and carries its claim in `billedPkr`, which is what puts it in Outstanding. Once a voucher settles it, `markSettlementNotePaid` flips `noteStatus` to `PAID` and the note **and the voucher credit that paid it drop out of every total together** (`noteStatus === "PAID" || settlesNoteRef`). Both rows stay visible for audit. That exclusion is deliberate twice over: the claim is closed, and money raised to settle a note must never read as free credit available to fund another truck (see `NOT_A_NOTE_VOUCHER` in `availableCreditPkr`).

### Sell side

Receivables debit at face value on truck assignment and are settled by voucher credits, so `billedPkr == amountPkr` and every total above collapses to the classic debit / credit / balance reading. Open (unsettled, unheld) debits age by `dueDate` into the buckets in `lib/finance-policy.ts`.

---

## 21. Trader desk — counterparty reports

**File:** `server/trader-reports.ts`  
**UI:** `components/trader/trader-desk-reports.tsx` (My Desk, below open trades)

Scoped to the signed-in trader's book. Filters: counterparty, commodity, direction (BUY/SELL).

### Open quantity (per counterparty)

From locked `ExecutionContract` rows for that trader's trades:

```
openBuyQtyMt  = Σ openQtyMt  where direction = BUY  and contractStatus = Open
openSellQtyMt = Σ openQtyMt  where direction = SELL and contractStatus = Open
fulfilledQtyMt = Σ receivedQtyMt on all locked contracts for that counterparty
```

### Weighted average cost (WAC)

Receipt-based, same formula as §19 entry rate — scoped to that counterparty's BUY `tradeRef`s only:

```
WAC PKR/MT = Σ (inbound receipt qty × contract rate PKR/MT) / Σ receipt qty (rated only)
```

Implementation: `computeWeightedPurchasePrice` in `server/inventory-valuation.ts`.

### Open-paper average rate

When no receipts exist yet, open BUY contracts contribute:

```
openPaperAvgRate = Σ (openQtyMt × contract rate PKR/MT) / Σ openQtyMt
```

### MTM (USD)

Sum of per-trade `mtmPnlUsd` on **LOCKED** and **CONFIRMED** trades for that counterparty (same scope as desk summary open MTM). PKR legs convert via desk FX (`PositionMarketInput`).

### Ledger outstanding

From shared counterparty ledger (`getCounterpartyLedgers`):

- **Buy owed** = BUY account `outstandingDebitPkr`
- **Sell owed** = SELL account `outstandingDebitPkr`

These are global ledger balances for the counterparty (not trader-scoped), mirrored from Finance → Ledgers.

---

## 22. Warehouse booked quantity at sell booking

**File:** `server/routers/trader.ts` (`warehouseAvailability`)
**UI:** `components/trader/warehouse-multi-select.tsx`, `app/(trader)/trader/trades/new/page.tsx`

Booking a SELL trade shows three numbers per warehouse for the selected commodity, so stock that is physically present but already promised out is not sold twice.

```
stockOnHandMt = Σ netQty from buildLocationCommodityInventory
                (for the selected commodity at that warehouse,
                 inbound receipts − released dispatches + unassigned gate trucks
                 + internal/external stock transfers)

bookedQtyMt   = Σ line.openQtyMt
                over warehouse allocation lines of ExecutionContract rows where
                  direction      = SELL
                  contractStatus = Open
                  commodityCode  = selected commodity

freeToSellMt  = max(0, stockOnHandMt − bookedQtyMt)
```

Per allocation line, `openQtyMt = max(0, qtyMt − fulfilledQtyMt)`. `fulfilledQtyMt` is kept in step with outbound dispatches by `refreshContract` (`server/execution/contracts.ts`).

Stock transfers must be passed to `buildLocationCommodityInventory` (via `loadStockTransfersForStock`), otherwise a warehouse stocked by shifts rather than by inbound receipts reads short of what Execution → Inventory shows for the same warehouse.

### Why booked and stock never double count

The two ledgers move on the same trigger:

| Event | Inventory (`outboundStockDelta`) | Contract fulfillment (`batchFulfillmentByWarehouse`) |
|-------|----------------------------------|------------------------------------------------------|
| Dispatch `AT_GATE` | no change — still in stock | not counted — still booked |
| Dispatch `WEIGHED` / `FINANCE_PENDING` / `RELEASED` | stock reduced | counted as fulfilled — booked reduced |

A load that leaves the yard drops out of stock and out of booked in the same step, so `freeToSellMt` is unchanged by dispatch. A truck sitting `AT_GATE` counts in both: physically present, already spoken for.

### Unassigned commitment

A locked SELL contract that has not been split across warehouses yet has open quantity with no warehouse to attribute it to. That quantity is summed into `unassignedBookedMt` and surfaced as a note on the booking form rather than silently dropped — booked figures understate the true commitment while it is non-zero.

### Scope and enforcement

Only **locked** open SELL contracts count. Unlocked and draft trades are excluded, since their per-warehouse quantity is not fixed until the execution head splits them at lock.

The booking form warns when the quantity being booked exceeds combined `freeToSellMt` across the picked warehouses, but never blocks the booking. Hard stock enforcement happens later in execution via `assertSufficientOutboundStock` (`server/execution/movements.ts`).

---

## 23. Shared buyer voucher pool

**File:** `server/finance/ledger.ts` (`availableCreditPkr`, `canFundTruck`, `computeSharedPoolAvailablePkr`)  
**UI:** Execution vouchers, gate truck payment step, counterparty ledgers

Every approved **sell-side voucher credit** for a buyer feeds **one shared pool** on that counterparty's SELL account. Optional `tradeRef` on the voucher and ledger row is **reconciliation only** — it does not reserve money for that trade.

### Available balance

```
totalCreditPkr       = Σ sell CREDIT rows (excluding note-voucher credits)
settlementEarmark    = Σ sell DEBIT rows linked to settlement invoices
earmarkedTruckDebits = Σ truck DEBIT rows whose saleStage ∈ VOUCHER_EARMARK_STAGES

availableCreditPkr   = max(0, totalCreditPkr − earmarkedTruckDebits − settlementEarmark)
```

When checking whether a specific truck can be funded, that truck's own earmark is omitted (`excludeTruckId`) so it does not block itself.

### Truck release

Both **advance-** and **credit-terms** trades use the same pool check in `canFundTruck`:

```
ok = availableCreditPkr ≥ truck receivable (incl. 236G)
```

If the pool is short, execution must use **Request release on credit** → trader approval → CEO approval → `CLEARED_UNPAID`. The buyer's ledger runs negative; truck debits age by `dueDate` from trade credit days — **informational only**, no aging-based blocking.

### Backward compatibility

No schema migration. Historical trade-linked credits automatically join the shared pool. In-flight trucks and settlement earmarks behave unchanged.

---

## 24. Partial settlement note vouchers (purchase)

**File:** `server/finance/ledger.ts` (`notePaidPkr`, `noteBalance`, `listOpenSettlementNotes`), `server/finance/vouchers.ts`  
**UI:** Execution vouchers (purchase side), counterparty ledgers

Purchase vouchers **must** name a settled purchase trade or an open cancellation note — there is no unlinked/direct payment on the BUY side. Settlement trade closure still counts only voucher credits tagged to **that trade** (no cross-trade pooling).

### Note internal sub-ledger

Each open note (`sourceType = ADJUSTMENT`, `noteStatus = UNPAID`) tracks partial payments via approved vouchers sharing its `noteRef`:

```
billedPkr     = note row amountPkr (full claim)
paidPkr       = Σ approved Voucher.amountPkr where noteRef matches
remainingPkr  = max(0, billedPkr − paidPkr)
```

The note stays in the voucher form **Against trade** dropdown while `remainingPkr > 500`.

### Closure tolerance

```
NOTE_SETTLE_TOLERANCE_PKR = 500

note closes when remainingPkr ≤ 500
```

On closure, `markSettlementNotePaid` runs and the note drops from open lists; the note row and its voucher credits remain visible for audit (excluded from balance totals together when paid).

### Voucher rules

- Payment **reference** (slip / cheque / transfer no.) is **required** on every voucher
- Duplicate guard: same **bank name** (blank when not a bank transfer) + **reference** + **voucher date** + **amount** cannot be submitted if a pending or approved voucher already exists with that combination
- `createVoucher`: amount must be positive and `≤ remainingPkr + 0.005`
- `approveVoucher`: posts ledger CREDIT, then closes the note only if remaining is within tolerance
- Each approved piece hits the ledger immediately; partial progress shows on the note row in counterparty ledgers


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

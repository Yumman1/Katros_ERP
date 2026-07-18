# 04 — Trade Lifecycle

See: [diagrams/trade-lifecycle.mmd](./diagrams/trade-lifecycle.mmd), [08-formulas-and-calculations.md](./08-formulas-and-calculations.md)

## TradeStatus enum (Prisma)

`PENDING` | `LOCKED` | `CONFIRMED` | `EXECUTED` | `SETTLED` | `CANCELLED`

Mock book primarily uses: **PENDING** (draft/unreviewed) → **LOCKED** → **EXECUTED**.

---

## Sub-states within PENDING

| Sub-state | Conditions | UI label |
|-----------|------------|----------|
| **Draft** | `PENDING` AND `submittedToExecution !== true` | Draft |
| **Unreviewed** | `PENDING` AND `submittedToExecution === true` | Unreviewed |
| **Awaiting price** | `pendingTraderPrice === true` | Trader must enter price |
| **Awaiting trader review** | `pendingTraderReview === true` | Execution edited trade |
| **Awaiting warehouse approval** | `pendingWarehouseApproval === true` | Split pending head |

Helpers: `lib/trade-lifecycle.ts`

---

## State machine

```
[*] → Draft                    trader.bookTrade (submitToExecution: false)
Draft → Unreviewed             trader.submitTradeToExecution
Unreviewed → Locked            execution.lockOpenTrade OR trader.lockTrade
Unreviewed → AwaitingPrice     bookTrade with unfixed basis, no price
AwaitingPrice → Unreviewed     trader.completeTradePrice
Unreviewed → AwaitingReview    execution.updateOpenTrade (sets pendingTraderReview)
AwaitingReview → Locked        trader.lockTrade
Locked → Executed              auto-close OR manual close (CEO)
```

### Lock gates (`executionCanLockOpenTrade`)

All must pass:

1. NOT `pendingTraderReview`
2. NOT `pendingTraderPrice`
3. If warehouse required (`PURCHASE_DELIVERED` or `SALE_EX_WAREHOUSE`): `warehouseSplitApproved === true`

---

## Key transitions

| Transition | Procedure | Server function |
|------------|-----------|-----------------|
| Book draft | `trader.bookTrade` | `mockBookTrade` in `server/dummy-data.ts` |
| Submit | `trader.submitTradeToExecution` | `submitTradeToExecution` in `server/open-trades.ts` |
| Edit draft | `trader.updateDraftTrade` | `updateTraderDraftTrade` — no approval |
| Enter price | `trader.completeTradePrice` | `completeTraderTradePrice` |
| Execution edit | `execution.updateOpenTrade` | `updateOpenTradeDirect` — may set `pendingTraderReview` |
| Lock (execution) | `execution.lockOpenTrade` | `lockOpenTradeFromExecution` → `lockTradeInStore` |
| Lock (trader ack) | `trader.lockTrade` | `lockOpenTradeAfterTraderReview` |
| Auto-close | (on fulfillment refresh) | `shouldAutoCloseContract` in `lib/contract-closure.ts` |
| Manual close | `team.submitChangeRequest` CLOSE → CEO | `closeLockedContract` |

---

## Booking form → MockTraderTrade

Page: `app/(trader)/trader/trades/new/page.tsx`

| Form section | Maps to |
|--------------|---------|
| Commodity, counterparty, direction, tradeScope | commodity, counterparty, direction, tradeScope |
| Quantity + unit | quantityEntered, quantityEnteredUnit → converted to quantity (MT) |
| Price currency, weight unit, price, commission | priceCurrency, priceWeightUnit, price, commissionPerUnit |
| Price basis | priceBasis; unfixed allows empty price |
| Quantity tolerance | tradeParams.quantityTolerance (+/- N% or MT) |
| Delivery window | deliveryStart, deliveryEnd |
| Incoterms | incoterms → drives executionProfile at lock |
| Payment type, credit days | paymentType, tradeParams.creditDays |
| Warehouses (multi) | tradeParams.warehouseSelections |
| Corn specs / trade params | qualityTolerancesDetail, tradeParams |
| Notes | notes |
| Submit vs draft | submitToExecution flag on bookTrade |

Validation: Zod schema in page; deliveryEnd ≥ deliveryStart; CREDIT requires creditDays; fixed basis requires price + commission.

---

## Incoterm and payment rules

**File:** `lib/trade-constants.ts`

### Booking incoterms by direction/scope

| Context | Allowed |
|---------|---------|
| BUY LOCAL (non-corn) | Spot, Delivered |
| BUY LOCAL (corn) | EXW, Delivered |
| BUY INTERNATIONAL | Spot, Delivered + standard |
| SELL | Ex-Warehouse + standard |

Default LOCAL: **Delivered**. Default SELL: **Ex-Warehouse**.

### Price basis

- Requires quote at booking: `Fixed`, `Fixed/Spot` only
- Corn: `Fixed/Spot`, `Unfixed`
- Unfixed: can submit without price; `pendingTraderPrice = true`

### Payment types

`DP`, `LC`, `CAD`, `ADVANCE_100`, `CREDIT`, `AFTER_DELIVERY_100`  
Corn LOCAL excludes DP and CAD.

---

## Warehouse split (pre-lock)

1. Trader may hint warehouses at booking (`warehouseSelections`)
2. Execution splits qty across warehouses (`executionWarehouseSplit`)
3. Staff submits for head approval OR head applies directly
4. On approval: `warehouseSplitApproved = true`
5. Lock blocked until approved when profile requires warehouse

Entity types: `OPEN_TRADE_WAREHOUSE` (change request), `execution.approveOpenTradeWarehouseSplit` (head direct).

---

## Contract parallel status

After lock, `ExecutionContract` tracks:

- `contractStatus`: `Open` | `Close`
- `receivedQtyMt`, `openQtyMt` — refreshed on each inbound/outbound/spot event
- `quantityToleranceMt` — from booking

Trade `tradeStatus` becomes `EXECUTED` when contract closes (auto or manual).

---

## Trader edit approval rules

| Trade state | Edit path |
|-------------|-----------|
| Draft | Direct `updateDraftTrade` |
| Submitted (unreviewed) | Change request → CEO (`TRADE` EDIT/DELETE) |
| Locked | Change request → CEO for material edits; execution head for warehouse split |

---

## Activity log

**File:** `server/trade-activity.ts`

Entries on book, submit, execution edit, lock, change requests. Shown in `TradeActivityPanel` for trader and execution audiences.

---

## Related docs

- [05-execution-profiles.md](./05-execution-profiles.md) — post-lock physical flows
- [07-approvals-workflow.md](./07-approvals-workflow.md) — change requests
- [02-data-model.md](./02-data-model.md) — MockTraderTrade fields

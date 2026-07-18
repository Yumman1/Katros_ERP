# 02 — Data Model

See also: [diagrams/erd-prisma.mmd](./diagrams/erd-prisma.mmd), [diagrams/erd-mock-runtime.mmd](./diagrams/erd-mock-runtime.mmd)

## Overview

Kastros CTRM uses **two data layers**:

1. **Prisma / PostgreSQL** — canonical schema for dashboard analytics, inventory, MTM, traceability (used when `MOCK_MODE` is false).
2. **Mock runtime + JSON** — operational truth for **trader booking** and **execution** in dev/default mode.

Source: `prisma/schema.prisma`, `server/dummy-data.ts`, `server/execution/runtime.ts`

---

## Prisma enums (all values)

### Role
`ADMIN` | `CEO` | `TRADER` | `EXECUTION` | `RISK_MANAGER` | `FINANCE` | `READ_ONLY`

### CommodityCategory
`GRAINS` | `OILSEEDS` | `SOFTS` | `VEGOIL` | `OTHER`

### CounterpartyType
`TRADING_PARTNER` | `BUYER` | `SELLER` | `BROKER` | `BANK`

### LocationType
`PORT` | `WAREHOUSE` | `SILO` | `FARM`

### TradeDirection
`BUY` | `SELL`

### PriceType
`FIXED` | `FLOATING` | `BASIS`

### TradeStatus
`PENDING` | `LOCKED` | `CONFIRMED` | `EXECUTED` | `SETTLED` | `CANCELLED`

### InventoryStatus
`IN_STOCK` | `RESERVED` | `TRANSIT` | `DELIVERED`

### MovementType
`IN` | `OUT` | `TRANSFER` | `ADJUSTMENT`

### InvoiceStatus
`DRAFT` | `SENT` | `PARTIALLY_PAID` | `PAID` | `OVERDUE`

### InvoiceType
`PURCHASE` | `SALES` | `PROVISIONAL` | `FINAL`

### CashFlowType
`TRADE_RECEIPT` | `TRADE_PAYMENT` | `FINANCING` | `FX` | `OVERHEAD` | `OTHER`

### ReconType
`TRADE_VS_INVOICE` | `INVOICE_VS_PAYMENT` | `POSITION_VS_INVENTORY` | `PAYMENT_VS_BANK`

### ReconStatus
`MATCHED` | `BREAK` | `PENDING_REVIEW` | `RESOLVED`

### TraceEventType
`HARVEST` | `PROCESSING` | `STORAGE` | `TRANSPORT` | `SALE`

### ExecutionStage
`PENDING_VEHICLE_ARRIVAL` | `VEHICLE_ARRIVED` | `OFFLOADING_IN_PROGRESS` | `OFFLOADING_COMPLETED` | `QUALITY_CHECK_IN_PROGRESS` | `QUALITY_CHECK_COMPLETED` | `INVENTORY_RECORDED` | `INVOICE_RECEIVED` | `PAYMENT_PENDING` | `PAYMENT_RECEIVED` | `COMPLETED` | `REJECTED`

### DocumentType
`TRUCK_RECEIVING_NOTE` | `GOODS_RECEIVING_NOTE` | `BILTY` | `WEIGH_SLIP_SPOT` | `WEIGH_SLIP_WAREHOUSE` | `LSP_REPORT` | `DELIVERY_CHALLAN` | `BROKER_QUOTATION` | `MARKET_VISIT_REPORT` | `INVOICE` | `COMMISSION_BREAKDOWN` | `PAYMENT_PROOF` | `RELEASE_AUTHORIZATION` | `OTHER`

### PaymentStatus (execution/finance)
`PENDING` | `APPROVED` | `REJECTED` | `PAID` | `FAILED`

---

## Prisma models (field summary)

### User
| Field | Type | Notes |
|-------|------|-------|
| id | String @id @cuid | |
| email | String @unique | |
| passwordHash | String | bcrypt |
| name | String? | |
| role | Role | default READ_ONLY |

### Commodity
| Field | Type |
|-------|------|
| id, name, code @unique, unit, exchange?, tickerCode?, category | |
| createdById → User | |

### Counterparty
| Field | Type |
|-------|------|
| id, name, code @unique, type, country, creditLimit? Decimal(20,4) | |

### Location
| Field | Type |
|-------|------|
| id, name, type LocationType, country | |

### Trade
| Field | Type |
|-------|------|
| tradeRef @unique, tradeDate, commodityId, counterpartyId, direction | |
| quantity, price Decimal(20,6), currency, priceType | |
| deliveryStart, deliveryEnd, originLocationId?, destLocationId? | |
| paymentTerms, tradeStatus, contractRef?, desk?, traderName? | |

### MarketPrice
Index: `[commodityId, priceDate]`

### Position
Unique: `[commodityId, positionDate]`. Fields: longQty, shortQty, netQty, avgBuyPrice?, avgSellPrice?, currency.

### PositionLeg
Links Position ↔ Trade with quantity and direction. Cascade delete on position.

### MTMValue
Index: `[tradeId, valuationDate]`. Fields: marketPrice, bookPrice, mtmPnl, unrealizedPnl.

### Inventory
Index: `[commodityId, locationId]`. Fields: quantity, unit, valuationPrice, totalValue, status, reservedQty, inTransitQty.

### InventoryMovement
Cascade on inventory delete.

### Shipment, Invoice, Payment, CashFlowEntry, Reconciliation, BankTransaction
Standard finance/supply-chain entities — see `prisma/schema.prisma`.

### TraceabilityRecord, TraceChainEntry, TradeTraceabilityLink
Batch traceability with chain of custody events.

### ExecutionLog + children
| Model | Relation |
|-------|----------|
| ExecutionLog | executionRef @unique, tradeRef, executionType, stage ExecutionStage |
| Document | → ExecutionLog, documentType DocumentType |
| InventoryReceival | 1:1 ExecutionLog — quality/offload fields |
| SpotPurchase | 1:1 ExecutionLog — selector/broker/weight |
| OutboundDispatch | 1:1 ExecutionLog — FIFO, finance release |
| ExecutionPayment | → ExecutionLog, paymentStatus |

**Note:** Prisma execution models parallel mock runtime; live trader/execution UI primarily uses JSON runtime in mock mode.

---

## Mock runtime — JSON files

| File | Constant | Module |
|------|----------|--------|
| `booked-trades.json` | `TRADES_FILE` | `server/dummy-data.ts` |
| `execution-state.json` | `EXECUTION_FILE` | `server/execution/runtime.ts` |
| `master-data.json` | `MASTER_DATA_FILE` | `server/trader-master-data.ts` |
| `change-requests.json` | inline | `server/change-requests-store.ts` |
| `market-prices.json` | inline | `server/market-prices.ts` |
| `position-adjustments.json` | inline | `server/position-ledger.ts` |
| `gatepass-docs/{gatepassNo}/` | filesystem | `server/gatepass-documents.ts` |

Serialization: **superjson** via `server/local-persist.ts` (Dates, Decimals preserved).

### booked-trades.json shape

```typescript
type BookedTradesSnapshot = {
  mockTradeSeq: number;
  bookedTrades: MockTraderTrade[];
};
```

### execution-state.json shape

```typescript
type ExecutionSnapshot = {
  contracts: [string, ExecutionContract][];
  inboundReceipts: InboundReceipt[];
  outboundDispatches: OutboundDispatch[];
  spotEvents: [string, SpotPurchaseEvent][];
  paymentRequests: PaymentRequest[];
  pendingTrucks: PendingTruck[];
  inboundSeq: number;
  outboundSeq: number;
  paymentSeq: number;
  truckSeq: number;
  gateInvoiceSeq: number;
};
```

---

## MockTraderTrade (field-by-field)

Source: `server/dummy-data.ts`

| Field | Type | Purpose |
|-------|------|---------|
| id | string | Internal id |
| tradeRef | string | Business key (e.g. KAS-2026-10001) |
| tradeDate | Date | |
| traderName | string | Display name |
| desk | string | Desk label |
| direction | TradeDirection | BUY / SELL |
| quantity | number | **Stored in MT** after booking conversion |
| quantityUnit | string | Usually "MT" |
| quantityEntered? | number | Original entry qty |
| quantityEnteredUnit? | string | Original unit |
| price | number | Quoted unit price |
| currency | string | Settlement currency label |
| priceBasis | string | Fixed, Unfixed, Index-linked, Fixed/Spot |
| priceCurrency? | PriceCurrency | PKR, USD, USd |
| priceWeightUnit? | string | MT, MAUND_40, etc. |
| priceKgPerUnit? | number | kg per price unit |
| pricePerCanonicalQty? | number | Price per MT in base currency |
| commissionPerUnit? | number | Per quoted weight unit |
| commissionPerMaund? | number | Legacy maund commission |
| commissionAmount? | number | Total commission quoted currency |
| commissionPerCanonicalQty? | number | Commission per MT |
| tradeStatus | TradeStatus | PENDING until lock, then LOCKED/EXECUTED |
| deliveryStart, deliveryEnd | Date | |
| originName, destName | string | Load/delivery points |
| incoterms | string | Spot, Delivered, Ex-Warehouse, EXW, etc. |
| paymentType | PaymentType | DP, LC, CAD, etc. |
| paymentTerms | string | Human label |
| grade | string | |
| productOrigin | string | |
| qualityTolerances | string | Summary string |
| qualityTolerancesDetail? | QualityTolerances | Corn percent fields |
| maxMoisturePct? | number | |
| tradeParams? | Record<string, string \| number \| null> | quantityTolerance, broker, warehouseSelections, etc. |
| commodity | { id, code, name, unit } | Embedded |
| counterparty | { id, name, code, ntn?, ... } | Embedded |
| marketPrice | number | Desk mark for MTM preview |
| mtmPnl | number | Preview PnL |
| notes? | string | |
| buyingCategory? | Delivered \| Spot | |
| tradeScope? | LOCAL \| INTERNATIONAL | |
| executionProfile? | string | Set at lock |
| ratePerMaund?, ratePerKg? | number | Locked rate derivations |
| counterpartyKycStatus | KycStatus | |
| counterpartyKycRef | string \| null | |
| contractRef | string \| null | |
| submittedToExecution? | boolean | true = unreviewed |
| submittedToExecutionAt? | Date | |
| pendingTraderReview? | boolean | Execution edited; trader must lock |
| pendingTraderPrice? | boolean | Unfixed; trader must enter price |
| executionEditNote? | string | |
| executionLastEditedBy?, executionLastEditedAt? | | |
| warehouseSplitApproved? | boolean | Head approved qty split |
| warehouseSplitApprovedAt?, warehouseSplitApprovedBy? | | |
| pendingWarehouseApproval? | boolean | Split awaiting head |
| lockedAt?, lockedBy? | | Set on lock |
| activityLog? | TradeActivityEntry[] | Audit trail |

---

## ExecutionContract (field-by-field)

Source: `server/execution/runtime.ts`

| Field | Type | Purpose |
|-------|------|---------|
| tradeRef | string | PK |
| tradeId | string | Links to MockTraderTrade.id |
| contractDate | Date | Lock date |
| direction | TradeDirection | |
| executionProfile | ExecutionProfile | PURCHASE_DELIVERED \| PURCHASE_SPOT \| SALE_EX_WAREHOUSE |
| tradeScope | TradeScope | LOCAL \| INTERNATIONAL |
| incoterms | string | |
| buyingCategory | BuyingCategory \| null | |
| commodityCode, commodityName | string | |
| counterpartyName, counterpartyCode | string | |
| counterpartyNtn | string \| null | |
| quantityUnit | string | |
| contractualQtyMt | number | Locked quantity |
| receivedQtyMt | number | Fulfilled (refreshed) |
| openQtyMt | number | contractual − received |
| contractStatus | Open \| Close | |
| quantityToleranceMt | number | From booking tolerance |
| qualityTolerances | QualityTolerances | |
| ratePerMaund, ratePerKg | number \| null | |
| unitPrice | number \| null | Booked price |
| priceCurrency, priceWeightUnit | string \| null | |
| commissionPerMaund | number \| null | |
| currency | string | |
| warehouseDefault | string \| null | |
| traderWarehouseHint | string \| null | |
| traderWarehouseSelections | string[] | From booking |
| allocatedWarehouse | string \| null | Deprecated single WH |
| warehouseAllocations | WarehouseAllocationLine[] | { warehouseName, qtyMt, fulfilledQtyMt?, openQtyMt? } |
| traderName | string | |
| lockedAt, lockedBy | Date, string | |
| deliveryStart, deliveryEnd | Date \| null | |

---

## PendingTruck (gatepass)

| Field | Notes |
|-------|-------|
| gatepassNo | Unique gate reference |
| movementType | INBOUND \| OUTBOUND |
| warehouseName, truckNo | |
| counterpartyName, commodityCode | |
| weightAsPerBuiltyKg | Drives allocation weight |
| warehouseWeightKg, totalDeductionsKg | Inbound weighment |
| status | PENDING \| ASSIGNED \| PARTIAL |
| assignedTradeRef?, remainingKg | After partial assign |

---

## InboundReceipt statuses
`DRAFT` | `ALLOCATED` | `FINANCE_PENDING` | `PAID`

Key field: `allocatedQtyMt` counts toward fulfillment when status ≠ DRAFT.

## OutboundDispatch statuses
`AT_GATE` | `WEIGHED` | `FINANCE_PENDING` | `RELEASED`

Key field: `allocatedQtyMt` counts when status ≠ AT_GATE.

## SpotPurchaseEvent states
`CONTRACT` | `SELECTED` | `LOADED` | `DC_ISSUED` | `INVOICED` | `FINANCE_PENDING` | `PAID` | `ON_THE_WAY` | `RECEIVED`

Fulfillment uses `warehouseReceiveWeightKg` when state = RECEIVED.

---

## ChangeRequest

Source: `server/change-requests-store.ts`

| Field | Type |
|-------|------|
| id | string (CR-NNNN) |
| department | EXECUTION \| FINANCE \| TRADING |
| entityType | TRADE, WAREHOUSE, COMMODITY, GATE_ENTRY, INBOUND, OUTBOUND, OPEN_TRADE_WAREHOUSE, LOCKED_CONTRACT_WAREHOUSE, PAYMENT |
| entityRef | string |
| entityLabel | string |
| action | CREATE \| EDIT \| DELETE \| CLOSE |
| comment | string |
| requestedById, requestedByName, requestedAt | |
| status | PENDING \| PENDING_CEO \| APPROVED \| REJECTED |
| payload? | Record for EDIT apply |
| departmentApprovedByName? | Warehouse CREATE path |
| applied? | boolean after apply |

---

## WarehouseAllocationLine

Source: `lib/warehouse-allocation.ts`

```typescript
type WarehouseAllocationLine = {
  warehouseName: string;
  qtyMt: number;
  fulfilledQtyMt?: number;
  openQtyMt?: number;
};
```

Serialized in tradeParams as `executionWarehouseSplit`: `"WH A:500|WH B:300"`

Trader selections key: `warehouseSelections` → pipe-separated warehouse names.

---

## Entity lifecycle (mock)

```
MockTraderTrade (PENDING, draft)
  → submitToExecution → PENDING (unreviewed)
  → lockOpenTrade → ExecutionContract + tradeStatus LOCKED
  → fulfillment → receivedQtyMt updated
  → auto-close OR manual close → contractStatus Close, tradeStatus EXECUTED
```

See [04-trade-lifecycle.md](./04-trade-lifecycle.md).

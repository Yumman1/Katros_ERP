# 09 — API Reference

tRPC base: `/api/trpc` — transformer: **superjson**  
Root router: `server/routers/_app.ts`

Legend: **Guard** = procedure middleware. Side effects list primary mock files mutated.

---

## trader (`server/routers/trader.ts`)

| Procedure | Guard | Purpose |
|-----------|-------|---------|
| deskSummary | protected | Trader KPI counts |
| myTrades | protected | List booked trades for session trader |
| tradeByRef | protected | Single MockTraderTrade |
| tradeTimeline | protected | Activity + status timeline |
| updateDraftTrade | TRADER, ADMIN | Direct draft edit → booked-trades.json |
| myExposure | protected | MTM exposure by commodity |
| actionItems | protected | Pending price/review items |
| referenceData | protected | Commodities, CPs, units, warehouses |
| warehouseAvailability | protected | WH capacity for commodity |
| addCommodity | CEO, ADMIN | Direct add (non-approval path) |
| addGrade | TRADER, ADMIN | Master data |
| addLocation | TRADER, ADMIN | Master data |
| addCounterparty | TRADER, ADMIN | Master data |
| addUnit | TRADER, ADMIN | Unit registry |
| bookTrade | TRADER, ADMIN | Create MockTraderTrade |
| lockTrade | TRADER, ADMIN | After execution edit review |
| submitTradeToExecution | TRADER, ADMIN | Draft → unreviewed |
| completeTradePrice | TRADER, ADMIN | Clear pendingTraderPrice |
| deleteTrade | head TRADING | Delete booked trade |
| exportLockedTrades | TRADER, ADMIN, EXECUTION | CSV export |
| exportTradeFile | TRADER, ADMIN, EXECUTION | Trade file export |
| positionLedger | protected | Paper vs physical |
| tradeFulfillment | protected | Locked trades + tolerance + progress |

---

## execution (`server/routers/execution.ts`)

| Procedure | Guard | Purpose |
|-----------|-------|---------|
| deskSummary | EXECUTION, ADMIN | Open counts, badges |
| openTrades | exec | Unreviewed list |
| openTradeByRef | exec | Detail |
| updateOpenTrade | head EXECUTION | Edit → may pendingTraderReview |
| lockOpenTrade | exec | Create ExecutionContract |
| lockedContracts | exec | Reviewed trades list |
| lockedTradeByRef | exec | Locked detail |
| updateLockedTrade | head EXECUTION | Locked edit |
| closeLockedContract | exec | Manual close |
| approveOpenTradeWarehouseSplit | head EXECUTION | Approve pre-lock split |
| allocateWarehouse | head EXECUTION | Single WH post-lock |
| allocateWarehouseSplit | head EXECUTION | Multi WH split |
| add/update/deleteWarehouseLocation | head EXECUTION | WH CRUD |
| pendingTrucks | exec | Gate register list |
| createPendingTruck | exec | Internal truck create |
| assignTruckToTrade | exec | Gatepass → receipt/dispatch |
| assignTruckFifoAuto | exec | FIFO assign |
| createInboundReceipt | exec | Purchase delivered |
| submitInboundForFinance | exec | Payment request |
| inboundReceipts | exec | List |
| createOutboundDispatch | exec | Sale dispatch |
| requestOutboundRelease | exec | Finance gate |
| releaseOutbound | exec | Release truck |
| outboundDispatches | exec | List |
| spotEvent / spotPipeline | exec | Spot state |
| advanceSpot | exec | Spot transition |
| submitSpotForFinance | exec | Spot payment |
| paymentRequests | exec, FINANCE | List |
| approvePayment / rejectPayment | exec, FINANCE | Payment status |
| update/delete GateEntry, Inbound, Outbound | head EXECUTION | Gate register edits |
| suggestInboundFifo / suggestSaleFifo | exec | FIFO hints |
| exportMovementsCsv | exec | CSV |
| tradeFileOptions / Preview / exportTradeFileCsv | exec, TRADER | Exports |
| positionLedger | exec, TRADER | Positions |
| setPositionAdjustment | head EXECUTION | Manual MT adj → position-adjustments.json |

`execRoles` = EXECUTION, ADMIN (typical).

---

## team (`server/routers/team.ts`)

| Procedure | Guard | Purpose |
|-----------|-------|---------|
| me | protected | Role, isHead, department |
| submitChangeRequest | protected | Create approval → change-requests.json |
| myChangeRequests | protected | Submitter inbox |
| changeRequests | head | Department head inbox |
| resolveChangeRequest | head | Approve/reject |
| pendingApprovals | head | Count badge |

---

## ceo (`server/routers/ceo.ts`)

| Procedure | Guard | Purpose |
|-----------|-------|---------|
| commodities | ceo | List registry |
| addCommodity | ceo | Direct register |
| deleteCommodity | ceo | Remove commodity |
| pendingApprovals | ceo | Count PENDING_CEO |
| approvalQueue | ceo | CEO inbox |
| tradeByRefForPreview | ceo | Trade preview for approval |
| resolveApproval | ceo | Final approve/reject + apply |
| dashboardSummary | ceo | Executive KPIs |

---

## finance (`server/routers/finance.ts`)

| Procedure | Guard | Purpose |
|-----------|-------|---------|
| pendingPayments | FINANCE, ADMIN | Awaiting approval |
| allPayments | FINANCE, ADMIN | Full list |
| approvePayment | FINANCE, ADMIN | Approve execution payment |
| rejectPayment | FINANCE, ADMIN | Reject |
| deletePayment | head FINANCE | Via change request apply |

---

## market (`server/routers/market.ts`)

| Procedure | Guard | Purpose |
|-----------|-------|---------|
| snapshot | exec, TRADER, RISK, READ_ONLY | Desk watch cards |
| dailyPrices | exec, TRADER, ADMIN | Price editor rows |
| options | exec | Currency/unit options |
| upsertDailyPrice | exec | Publish CNF/yesterday → market-prices.json |

---

## Dashboard routers (Prisma when not mock)

| Router | Key procedures |
|--------|----------------|
| positions | getSummaryCards, getExposureSummary, getBook, getTradesForCommodity |
| mtm | getBook, snapPrices, historyTotals |
| pnl | attribution |
| cashflow | list, upcoming |
| reconciliation | list, summary, runAutoTradeInvoice |
| inventory | summary, list, aging, movements |
| reports | kpis, tradeBlotter, scheduleReport, openBreaks |
| traceability | search, byId |
| commodity | list |
| supplyChain | overview, locations, counterparties, positionVsInventory |
| shipments | summary, list, byId |

---

## REST routes

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/trpc/[trpc]` | tRPC handler |
| GET/POST | `/api/auth/[...nextauth]` | NextAuth |
| GET | `/api/warehouse-gatepass` | Reference data for gatepass form |
| POST | `/api/warehouse-gatepass` | Create gatepass (multipart) |
| GET | `/api/sse/prices` | SSE price ticker stream |

---

## Invalidation pattern

`lib/invalidate-caches.ts` — `invalidateTradeFlowCaches`, `invalidateApprovalCaches`, `invalidateGateOpsCaches` — called after mutations to refresh React Query caches.

---

## Related

- [03-auth-and-roles.md](./03-auth-and-roles.md) — guards
- [07-approvals-workflow.md](./07-approvals-workflow.md) — change requests
- [06-warehouse-and-gatepass.md](./06-warehouse-and-gatepass.md) — gatepass REST

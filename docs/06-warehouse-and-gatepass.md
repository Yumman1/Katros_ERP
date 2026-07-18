# 06 — Warehouse and Gatepass

See: [diagrams/gatepass-pipeline.mmd](./diagrams/gatepass-pipeline.mmd)

---

## Warehouse master data

### Sources

- Prisma `Location` (type WAREHOUSE) when DB mode
- Mock `master-data.json` via `server/trader-master-data.ts`
- Merged in `execution.warehouseLocations`, `execution.companyWarehouses`

### Create warehouse

| Path | Flow |
|------|------|
| Execution setup page | `team.submitChangeRequest` entity `WAREHOUSE`, action `CREATE` |
| Execution head submit | Goes direct to `PENDING_CEO` (skips dept head) |
| Staff submit | `PENDING` → head `advanceChangeRequestToCeo` → CEO |
| CEO approve | `applyApprovedChangeRequest` adds to master data |

Pages: `/execution/warehouses/setup`, `/manage`, `/utilization`

### Edit / delete

Change request `WAREHOUSE` EDIT/DELETE — head of execution approval (no CEO unless CREATE).

Head direct CRUD: `execution.addWarehouseLocation`, `updateWarehouseLocation`, `deleteWarehouseLocation`.

### Costing fields

Per warehouse: capacitySqFt, grainDivisionSqFt, balesDivisionSqFt, rentalPerSqFtMonth, labor lines, managementFeePct.

Formulas: [08-formulas-and-calculations.md](./08-formulas-and-calculations.md) §6–7.

---

## Warehouse allocation

### Pre-lock (open trade)

1. Trader selects warehouses at booking → `tradeParams.warehouseSelections` (pipe-separated names)
2. Execution defines qty split → `tradeParams.executionWarehouseSplit` format: `"WH A:500|WH B:300"`
3. Validation: sum must equal contract qty (`allocationsSumMatchesContract`)
4. Head approval: `execution.approveOpenTradeWarehouseSplit` or change request `OPEN_TRADE_WAREHOUSE`
5. Sets `warehouseSplitApproved = true` — required before lock

**Components:** `open-trade-warehouse-allocation.tsx`, `warehouse-split-allocation.tsx`

### Post-lock (locked contract)

- Single WH: `execution.allocateWarehouse` → `allocateContractWarehouse`
- Multi split: `execution.allocateWarehouseSplit` → `allocateContractWarehousesSplit`
- Change request entity: `LOCKED_CONTRACT_WAREHOUSE`

### Progress tracking

`getWarehouseAllocationProgress(contract)` — per warehouse: qtyMt, fulfilledQtyMt, openQtyMt.

Trader fulfillment page shows allocation progress table.

---

## Gatepass (public REST API)

**Route:** `app/api/warehouse-gatepass/route.ts`  
**UI:** `app/warehouse/gatepass/page.tsx` (no auth — public)  
**Layout:** `app/warehouse/layout.tsx` — viewport scroll wrapper

### GET

Query params: `warehouseName`, `movementType` (INBOUND|OUTBOUND)

Returns:
- `warehouses[]`
- `inboundCounterparties[]` / `outboundCounterparties[]` (filtered by open locked trades at warehouse)
- `nextGatepassNo`

### POST

Creates pending truck via `createPendingTruck` in `server/execution/trucks.ts`.

**Schema:** `lib/gatepass-schema.ts` (Zod)

| Field | Required | Notes |
|-------|----------|-------|
| movementType | yes | INBOUND \| OUTBOUND |
| recordedByName | yes | Warehouse staff name |
| warehouseName | yes | Must exist in master |
| counterpartyName | yes | Must match allowed list for WH |
| commodityCode | yes | Must match allowed trades |
| builtyDetails | yes | Consignment reference |
| truckNo | yes | |
| weightAsPerBuiltyKg | yes | > 0 |
| transporterName, transporterPhone | optional | |
| weighBridgeName | optional | |
| warehouseWeightKg | optional | Inbound weighment |
| quantityBagsBales, totalDeductionsKg | optional | |
| qualitySpecs | optional | Corn tolerances |
| remarks | optional | |
| documents | optional | Multipart upload |

### Counterparty filter logic

Only counterparties with **open locked contracts** allocated to the selected warehouse appear in dropdown.

Functions: `isAllowedGatepassCounterparty`, `isAllowedGatepassCommodity` (execution store).

### Document storage

`data/local/gatepass-docs/{gatepassNo}/` — uploaded builty, weigh slips, photos.

---

## Gate register (execution desk)

**Page:** `/execution/movements`  
**Component:** `gate-register-actions.tsx`

Lists pending and assigned trucks. Execution head can:

- Edit gate entry: `execution.updateGateEntry` or change request `GATE_ENTRY`
- Delete: `execution.deleteGateEntry` or change request
- Edit inbound/outbound: `updateInboundReceipt`, `updateOutboundDispatch` + change requests `INBOUND`, `OUTBOUND`

Change requests appear in execution head **Approvals** inbox (`/execution/approvals`).

---

## Truck assignment

| Procedure | Behavior |
|-----------|----------|
| `execution.assignTruckToTrade` | Links pending truck to tradeRef; creates inbound or outbound record; partial weight supported |
| `execution.assignTruckFifoAuto` | Auto-assigns to oldest open contract (FIFO) |

After assignment: `PendingTruck.status` → ASSIGNED or PARTIAL; `remainingKg` updated.

---

## Gate invoice (inbound)

Auto-generated on some inbound gate entries:

Fields on PendingTruck: `gateInvoiceNo`, `gateInvoiceWeightKg`, `gateInvoiceQtyMt`, `gateInvoiceAmount`, `gateInvoiceTradeRef`.

Pricing from locked contract rate.

---

## Warehouse availability (trader booking)

**Procedure:** `trader.warehouseAvailability`

Returns per warehouse: availabilityPct, divisionAvailableMt, grain/bale division sq ft, storage division for commodity.

Uses utilization formulas — see doc 08.

**Component:** `warehouse-multi-select.tsx` on booking form.

---

## Utilization page

`/execution/warehouses/utilization` — capacity vs stock by warehouse, grain/bale balance.

---

## Related

- [05-execution-profiles.md](./05-execution-profiles.md)
- [07-approvals-workflow.md](./07-approvals-workflow.md)
- [09-api-reference.md](./09-api-reference.md) — REST + execution procedures

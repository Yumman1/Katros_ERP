# 10 — UI Routes and Components

---

## Workspace shells

| Shell | Layout | Nav file |
|-------|--------|----------|
| Trader | `app/(trader)/layout.tsx` | `components/layout/trader-shell.tsx` |
| Execution | `app/(execution)/layout.tsx` | `components/layout/execution-shell.tsx` |
| CEO | `app/(ceo)/layout.tsx` + CeoAccessGuard | `components/layout/ceo-shell.tsx` |
| Dashboard | `app/(dashboard)/layout.tsx` | `components/layout/dashboard-shell.tsx` |
| Finance | `app/(finance)/layout.tsx` | Reuses dashboard-shell |
| Auth | `app/(auth)/layout.tsx` | Scroll wrapper |
| Warehouse | `app/warehouse/layout.tsx` | Minimal scroll |

Shared: `components/layout/app-shell.tsx`, `shell-header.tsx`, `desk-page.tsx`

---

## Trader routes

| Route | Page | Key components |
|-------|------|----------------|
| `/trader` | trader/page.tsx | Desk summary |
| `/trader/trades` | trades/page.tsx | Trade list |
| `/trader/trades/new` | trades/new/page.tsx | Booking form — contract-details, quantity-tolerance, corn-spec, warehouse-multi-select |
| `/trader/trades/[ref]` | trades/[ref]/page.tsx | Trade detail, TradeChangeForm, TradeActivityPanel |
| `/trader/fulfillment` | fulfillment/page.tsx | Progress, manual close modal |
| `/trader/positions` | positions/page.tsx | PositionLedgerTable, CommodityFilterBar |
| `/trader/market` | market/page.tsx | Market snapshot cards |
| `/trader/approvals` | approvals/page.tsx | ApprovalsInbox |
| `/trader/change-requests` | change-requests/page.tsx | ChangeRequestsInbox |

---

## Execution routes

| Route | Page | Key components |
|-------|------|----------------|
| `/execution` | execution/page.tsx | Desk overview, PendingWarehousePanel |
| `/execution/open-trades` | open-trades/page.tsx | OpenTradesPage |
| `/execution/open-trades/[ref]` | open-trades/[ref]/page.tsx | OpenTradeDetail |
| `/execution/contracts` | contracts/page.tsx | LockedContractsPage |
| `/execution/contracts/[ref]/edit` | contracts/[ref]/edit/page.tsx | OpenTradeDetail mode=locked |
| `/execution/prices` | prices/page.tsx | Daily price editor |
| `/execution/inventory` | inventory/page.tsx | Execution inventory view |
| `/execution/positions` | positions/page.tsx | Position ledger |
| `/execution/movements` | movements/page.tsx | Gate register, GateRegisterActions |
| `/execution/warehouses` | warehouses/page.tsx | Warehouse hub |
| `/execution/warehouses/setup` | setup/page.tsx | WH create + costing |
| `/execution/warehouses/manage` | manage/page.tsx | WH edit/delete requests |
| `/execution/warehouses/utilization` | utilization/page.tsx | Capacity charts |
| `/execution/payments` | payments/page.tsx | Payment requests |
| `/execution/approvals` | approvals/page.tsx | Team Approvals — team queue (head only) |
| `/execution/approvals/do` | approvals/do/page.tsx | Team Approvals DO tab |
| `/execution/approvals/rejections` | approvals/rejections/page.tsx | Team Approvals rejections tab |
| `/execution/my-approvals` | my-approvals/page.tsx | Redirect → my-approvals/approvals |
| `/execution/my-approvals/approvals` | my-approvals/approvals/page.tsx | My Approvals — pending/approved requests |
| `/execution/my-approvals/rejections` | my-approvals/rejections/page.tsx | My Approvals — rejected requests |
| `/execution/rejections` | rejections/page.tsx | Redirect → `/execution/approvals/rejections` |
| `/execution/delivery-order-approvals` | delivery-order-approvals/page.tsx | Redirect → `/execution/approvals/do` |
| `/execution/trade-files` | trade-files/page.tsx | Export bar |
| `/execution/[scope]/purchase-delivered` | [scope]/purchase-delivered/page.tsx | PurchaseDeliveredDesk |
| `/execution/[scope]/purchase-spot` | [scope]/purchase-spot/page.tsx | PurchaseSpotDesk |
| `/execution/[scope]/sales` | [scope]/sales/page.tsx | SalesDesk |
| `/execution/purchase-delivered/[ref]` | purchase-delivered/[ref]/page.tsx | Contract detail |
| `/execution/purchase-spot/[ref]` | purchase-spot/[ref]/page.tsx | Spot pipeline UI |
| `/execution/sales/[ref]` | sales/[ref]/page.tsx | Outbound detail |
| `/execution/change-requests` | change-requests/page.tsx | Redirect → approvals |

Scope path: `local` | `international` (`lib/trade-constants.ts` tradeScopeFromPathSegment).

Legacy redirects: `/execution/purchase-spot` → `/execution/local/purchase-spot`, etc.

---

## CEO routes

| Route | Page | Components |
|-------|------|------------|
| `/ceo` | ceo/page.tsx | Dashboard widgets |
| `/ceo/commodities` | commodities/page.tsx | CommodityRegistrationFields |
| `/ceo/approvals` | approvals/page.tsx | CeoApprovalsInbox |

---

## Dashboard routes

| Route | Page |
|-------|------|
| `/overview` | overview/page.tsx |
| `/positions` | positions/page.tsx |
| `/mtm` | mtm/page.tsx |
| `/pnl` | pnl/page.tsx |
| `/cashflow` | cashflow/page.tsx |
| `/reconciliation` | reconciliation/page.tsx |
| `/supply-chain` | supply-chain/page.tsx |
| `/inventory` | inventory/page.tsx |
| `/shipments` | shipments/page.tsx |
| `/locations` | locations/page.tsx |
| `/suppliers` | suppliers/page.tsx |
| `/traceability` | traceability/page.tsx |
| `/traceability/[id]` | traceability/[id]/page.tsx |
| `/reports` | reports/page.tsx |
| `/analytics` | analytics/page.tsx |

---

## Finance routes

| Route | Page |
|-------|------|
| `/finance/payments` | finance/payments/page.tsx |
| `/finance/change-requests` | finance/change-requests/page.tsx |

---

## Public / auth

| Route | Page |
|-------|------|
| `/` | Redirect by role |
| `/login` | login/page.tsx |
| `/warehouse/gatepass` | warehouse/gatepass/page.tsx |

---

## Component map by feature

### Trading
| Component | Path |
|-----------|------|
| ContractDetailsFields | components/trader/contract-details-fields.tsx |
| TradeParametersFields | components/trader/trade-parameters-fields.tsx |
| CornSpecificationFields | components/trader/corn-specification-fields.tsx |
| QuantityToleranceField | components/trader/quantity-tolerance-field.tsx |
| WarehouseMultiSelect | components/trader/warehouse-multi-select.tsx |
| TradeChangeForm | components/trader/trade-change-form.tsx |
| CommodityRegistrationFields | components/trader/commodity-registration-fields.tsx |

### Execution
| Component | Path |
|-----------|------|
| OpenTradesPage | components/execution/open-trades-page.tsx |
| OpenTradeDetail | components/execution/open-trade-detail.tsx |
| LockedContractsPage | components/execution/locked-contracts-page.tsx |
| ClosedTradesSection | components/execution/closed-trades-section.tsx |
| OpenTradeWarehouseAllocation | components/execution/open-trade-warehouse-allocation.tsx |
| ManualTruckAllocation | components/execution/manual-truck-allocation.tsx |
| ExecutionProfileDesk | components/execution/execution-profile-desk.tsx |
| SpotPipelinePanel | components/execution/spot-pipeline-panel.tsx |
| GateRegisterActions | components/execution/gate-register-actions.tsx |
| WarehouseCostingFields | components/execution/warehouse-costing-fields.tsx |
| WarehouseSubnav | components/execution/warehouse-subnav.tsx |
| CommodityFilterBar | components/execution/commodity-filter-bar.tsx |
| ExcelExportBar | components/execution/excel-export-bar.tsx |

### Approvals
| Component | Path |
|-----------|------|
| ApprovalsInbox | components/team/approvals-inbox.tsx |
| ChangeRequestsInbox | components/team/change-requests-inbox.tsx |
| ExecutionApprovalsTabs | components/execution/execution-approvals-tabs.tsx |
| ExecutionMyApprovalsTabs | components/execution/execution-my-approvals-tabs.tsx |
| ExecutionMyApprovalsPanel | components/execution/execution-my-approvals-panel.tsx |
| DoApprovalsPanel | components/execution/do-approvals-panel.tsx |
| ExecutionRejectionsPanel | components/execution/execution-rejections-panel.tsx |
| CeoApprovalsInbox | components/team/ceo-approvals-inbox.tsx |
| TradeEditChangePreview | components/team/trade-edit-change-preview.tsx |
| EntryActions | components/team/entry-actions.tsx |

### Shared
| Component | Path |
|-----------|------|
| TradeActivityPanel | components/trade/trade-activity-panel.tsx |
| PositionLedgerTable | components/position/position-ledger-table.tsx |
| PageHeader | components/ui/page-header.tsx |
| ListPagination | components/ui/list-pagination.tsx |
| GatepassFormFields | components/warehouse/gatepass-form-fields.tsx |

---

## Key form validation

| Form | Schema location |
|------|-----------------|
| Book trade | Zod in `trades/new/page.tsx` |
| Gatepass | `lib/gatepass-schema.ts` |
| Commodity create | `lib/commodity-registration.ts` commodityCreateInputSchema |
| Warehouse setup | Inline validation in setup page |

---

## Related

- [03-auth-and-roles.md](./03-auth-and-roles.md)
- [09-api-reference.md](./09-api-reference.md)
- [01-architecture.md](./01-architecture.md) — layout CSS

# 07 — Approvals Workflow

See: [diagrams/approvals-routing.mmd](./diagrams/approvals-routing.mmd)

---

## Change request model

Source: `server/change-requests-store.ts`, `lib/departments.ts`

### Actions
`CREATE` | `EDIT` | `DELETE` | `CLOSE`

### Statuses
`PENDING` | `PENDING_CEO` | `APPROVED` | `REJECTED`

### Entity types (used in app)

| entityType | Department | Description |
|------------|------------|-------------|
| TRADE | TRADING / EXECUTION | Booked trade edit/delete/close |
| COMMODITY | TRADING | New commodity registration |
| WAREHOUSE | EXECUTION | Warehouse CRUD |
| GATE_ENTRY | EXECUTION | Pending truck / gatepass |
| INBOUND | EXECUTION | Inbound receipt |
| OUTBOUND | EXECUTION | Outbound dispatch |
| OPEN_TRADE_WAREHOUSE | EXECUTION | Pre-lock warehouse split |
| LOCKED_CONTRACT_WAREHOUSE | EXECUTION | Post-lock warehouse split |
| PAYMENT | FINANCE | Payment request delete |

---

## CEO approval required

Source: `requiresCeoApproval()` in `lib/departments.ts`

| entityType | action | Notes |
|------------|--------|-------|
| WAREHOUSE | CREATE | After optional execution head step |
| TRADE | CLOSE | Manual contract close |
| COMMODITY | CREATE | Trader-requested commodity |
| TRADE | EDIT, DELETE | When department === TRADING (submitted trades) |

All other approved actions: department head only (no CEO).

---

## Routing matrix

| Entity | Action | Submitter | First approver | CEO? | Apply function |
|--------|--------|-----------|----------------|------|----------------|
| TRADE | EDIT (draft) | TRADER | — (direct) | No | `updateDraftTrade` |
| TRADE | EDIT (submitted) | TRADER | — | Yes | `applyTraderTradeEditFromPayload` |
| TRADE | DELETE (submitted) | TRADER | — | Yes | `deleteBookedTrade` |
| TRADE | CLOSE | TRADER/EXECUTION | — | Yes | `closeLockedContract` |
| TRADE | EDIT | EXECUTION head | Head | No | `applyExecutionTradeEditFromPayload` |
| COMMODITY | CREATE | TRADER | — | Yes | `addCustomCommodity` |
| COMMODITY | CREATE | CEO direct | — | No | `ceo.addCommodity` |
| WAREHOUSE | CREATE | EXECUTION staff | Head → CEO | Yes | `addCustomLocation` |
| WAREHOUSE | CREATE | EXECUTION head | — | Yes (direct PENDING_CEO) | `addCustomLocation` |
| WAREHOUSE | EDIT/DELETE | EXECUTION | Head | No | update/delete location |
| OPEN_TRADE_WAREHOUSE | EDIT | EXECUTION | Head | No | `applyOpenTradeWarehouseSplit` |
| LOCKED_CONTRACT_WAREHOUSE | EDIT | EXECUTION | Head | No | `allocateContractWarehousesSplit` |
| GATE_ENTRY | EDIT/DELETE | EXECUTION | Head | No | update/delete pending truck |
| INBOUND/OUTBOUND | EDIT/DELETE | EXECUTION | Head | No | update/delete receipt/dispatch |
| PAYMENT | DELETE | FINANCE | Head | No | `deletePaymentRequest` |

---

## Procedure flow

### Submit
`team.submitChangeRequest` — creates ChangeRequest with status:
- `PENDING_CEO` if `requiresCeoApproval(...)` OR execution head submits warehouse CREATE
- else `PENDING`

### Head resolve
`team.resolveChangeRequest` — headProcedure  
On APPROVED: if warehouse CREATE → `advanceChangeRequestToCeo`; else `applyApprovedChangeRequest` + status APPROVED.

### CEO resolve
`ceo.resolveApproval` — ceoProcedure  
On APPROVED: `applyApprovedChangeRequest` + status APPROVED.

### My requests
`team.myChangeRequests` — all requests by current user.

### Head inbox
`team.changeRequests` — filter by department, status PENDING.

### CEO inbox
`ceo.approvalQueue` — status PENDING_CEO.

---

## Apply payloads

Source: `server/change-request-apply.ts`

### TRADE EDIT (trading)
Payload: trade field patch from `TradeChangeForm` — price, qty, delivery, tradeParams, etc.  
Applies: `applyTraderTradeEditFromPayload(tradeRef, payload, actor)`

### TRADE EDIT (execution)
Applies: `applyExecutionTradeEditFromPayload` — may set `pendingTraderReview` on trader trade.

### TRADE CLOSE
Applies: `closeLockedContract(tradeRef, actor)` → contract Close, trade EXECUTED.

### COMMODITY CREATE
Payload: `commodityCreateInputSchema` — code, name, unit, tradeParameterDefs.  
Applies: `addCustomCommodity`.

### WAREHOUSE CREATE
Payload: location fields (name, code, capacitySqFt, costing, divisions).  
Applies: `addCustomLocation`.

### WAREHOUSE EDIT
Payload: partial location patch.  
Applies: `updateWarehouseLocation`.

### OPEN_TRADE_WAREHOUSE / LOCKED_CONTRACT_WAREHOUSE
```typescript
payload: {
  warehouseSplit: { warehouseName: string; openQtyMt: number }[]
}
```

### GATE_ENTRY / INBOUND / OUTBOUND EDIT
Payload: entity-specific patch matching update functions.

### DELETE actions
Routes to `deletePendingTruck`, `deleteInboundReceipt`, `deleteOutboundDispatch`, `deleteWarehouseLocation`, `deletePaymentRequest`, `deleteBookedTrade` by entity type.

---

## UI inboxes

| User | Page | Component |
|------|------|-----------|
| Execution head | `/execution/approvals` | Hub: Team tab — `ApprovalsInbox` → `ChangeRequestsInbox` (PENDING queue only) |
| Execution head | `/execution/approvals/do` | Hub: DO tab — `DoApprovalsPanel` (approve / reject) |
| Execution head | `/execution/approvals/rejections` | Hub: Rejections tab — `ExecutionRejectionsPanel` |
| Execution staff | `/execution/approvals` | Hub: My requests view |
| Trader | `/trader/approvals`, `/trader/change-requests` | Same inbox pattern |
| Finance | `/finance/change-requests` | FINANCE department |
| CEO | `/ceo/approvals` | `CeoApprovalsInbox` |

Legacy URLs redirect into the hub: `/execution/rejections` → `/execution/approvals/rejections`, `/execution/delivery-order-approvals` → `/execution/approvals/do`.

Execution head rejecting a change request records `CHANGE_REQUEST_EXECUTION` on the Rejections tab. DO execution reject records `DO_EXECUTION` and returns the truck to `AWAITING_BALANCE`.

Gate register submit links to My requests (`gate-register-actions.tsx`).

Preview component: `trade-edit-change-preview.tsx` — shows diff for TRADE, GATE_ENTRY, INBOUND, OUTBOUND payloads.

---

## Warehouse CREATE special case

When **execution head** submits warehouse CREATE:
- Skips department PENDING — goes straight to `PENDING_CEO`
- Head approval fields still recorded if intermediate step used

When **staff** submits:
- Status PENDING → head reviews → `advanceChangeRequestToCeo` → CEO approves → create

---

## Invalidation

On resolve: `invalidateApprovalCaches(utils)` — refreshes team, ceo, execution caches.

---

## Related

- [03-auth-and-roles.md](./03-auth-and-roles.md)
- [04-trade-lifecycle.md](./04-trade-lifecycle.md)
- [06-warehouse-and-gatepass.md](./06-warehouse-and-gatepass.md)

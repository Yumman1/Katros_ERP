# Finance approvals, net positions, and commodity reporting

## Entry points

| Feature | Route |
| --- | --- |
| Finance Approvals | `/finance/approvals` (opens Payments) |
| DO approvals | `/finance/approvals/do` |
| Payment approvals | `/finance/approvals/payments` |
| Voucher approvals | `/finance/approvals/vouchers` |
| Counterparty net position | `/finance/ledgers` |
| Commercial margins | `/pnl/commercial-margins` |
| Finance commodity sales report | `/reports/commodity-sales` |
| Trader commodity sales report | `/trader/reports` |

The old payment, DO, and voucher URLs redirect to their new tabs. Existing
approval mutations, authorization, document preview, voucher history, and
settlement mechanics are reused. The combined Approvals badge excludes the
separate change-request queue.

## Reporting definitions

- Purchase minus sales: purchase value in the selected period minus sales value
  in that period, as requested. This can include purchases not yet sold.
- Gross profit/loss: sales value minus matched purchase cost of the sold quantity.
  A positive number means profit; negative means loss.
- Batch costing: replay receipts and released dispatches chronologically, using
  moving weighted-average receipt cost within a single explicitly linked batch.
  Earlier-period sales consume the batch before selected-period sales. Multiple
  receipts can contribute to one batch and partial sales consume only their share.
- Missing batch links, multi-batch trades without quantity allocations, invalid
  commodity links, missing quantities/values, insufficient prior purchase quantity,
  or mixed currencies do not receive invented cost or profit. The reason appears
  in the batch detail. Ambiguous consumption blocks later reuse of that batch.
- The schema only stores trade/batch associations, not quantity allocations.
  Single-batch links attribute that trade's movements to that batch; multi-batch
  allocation editing is not introduced. Reports do not create or change links.
- Finance reports use existing firm-wide dashboard permissions. Trader reports
  return only the session trader's trades and filter options. Supporting cost is
  calculated before trader/date/buyer/warehouse filters, so shared-batch historical
  consumption is respected. Linked purchase references support the cost audit.
- Delivered basis includes non-draft inbound receipts and RELEASED outbound
  dispatches. It uses their recorded amountDue and billed quantities, excludes
  direct settlements, and recognizes receipt/release dates. Standalone spot
  events without inbound receipts are not represented in this basis.
- Booked basis includes LOCKED, CONFIRMED, EXECUTED contracts and excludes direct
  settlement, pending/draft and cancelled trades. It recognizes trade dates and
  uses canonical prices. It does not claim realized batch profit.
- Quantity is normalized to MT only when a known conversion exists. Monetary
  currencies remain separate. There is no new FX conversion or additional tax,
  freight, commission, overhead, or return accounting.
- All period boundaries use Asia/Karachi. Weeks begin Monday. Years are calendar
  years. Previous full months/years compare to the previous calendar period;
  custom ranges compare to the preceding equal number of days.
- Reports are current projections of stored records, not immutable period-close
  snapshots. Later corrections can change historical totals.
- Excel/PDF exports include all applied-filter records, summary, period totals,
  batch sales, purchases, prior-period comparisons, buyer totals, and metadata.
  Local batch search, profit-status filter and table pagination do not limit exports.
  Scheduling and frozen period-close reports remain future work.

## Counterparty net position

`net = receivable - payable`, in PKR, over full ledger history.

- Positive: they owe us. Negative: we owe them. Zero: balanced.
- BUY gate invoices use billed minus actually paid amounts; held dues are included.
- SELL and settlement invoice payments use posted voucher credits (not an extra
  subtraction of paid truck amounts).
- Open notes contribute only their remaining claim, with side/type-aware signs.
  Closed notes and their dedicated voucher credits are excluded together.
- Legacy BUY PAYMENT audit entries are excluded, as they are in the existing view.
- Counterparty summary is a read-only projection. It does not net the two ledger
  accounts operationally or change funding, aging, or settlement eligibility.
- The new summary is mounted only in Finance; the shared ledger panel is unchanged.

## Verification commands

```sh
npm run test:finance-reporting
node --import tsx --test server/finance/ledger-funding.test.ts server/finance/ledger-note-settlement.test.ts server/finance/voucher-duplicate.test.ts
npx tsc --noEmit
npm run lint
npm run build
```

The node/tsx import form avoids the tsx CLI's IPC socket requirement in restricted
runtimes. Existing test commands are preserved.

## Smoke test checklist (use a test database)

1. Log in as Finance. Confirm one Approvals navigation entry and three tabs.
   Open each legacy URL and verify redirect and active tab. Verify the total and
   per-tab counts against actual pending records; change requests remain separate.
2. Approve a payment and a voucher, reject another with a required reason, and
   preview/approve a DO. Confirm counts refresh and existing execution progression,
   voucher history, ledger posting, and gate-pass eligibility remain correct.
3. Check zero-pending, loading, failed-query and denied-access states. Confirm
   unrelated roles cannot read/approve finance queues through API calls.
4. In Finance Ledgers, use a counterparty who buys and sells. For example,
   receivable 800 and remaining payable 300 must show +500, "They owe us".
   A buyer advance of 500 with no sales must show -500, "We owe them".
   Check partial purchases, held dues, both note directions, closed notes, and
   dedicated note vouchers. Expand the original ledger and exercise settlement.
5. For one batch, receive 1 MT for PKR 100,000; release 0.4 MT for PKR 60,000.
   The report must show cost 40,000, profit +20,000, and the purchase reference.
   A subsequent 0.6 MT sale consumes the remaining 60,000 cost. Another sale must
   be uncosted unless further linked receipts exist.
6. Repeat with a prior-month sale, a new receipt at a different rate, missing
   batch links, multi-batch links, different currencies, and unknown units. Confirm
   missing cost is never treated as zero. Reconcile totals to supporting records.
7. Check weekly/monthly/yearly/custom filters, dates around midnight Pakistan
   time, previous-period comparisons, leading buyers, batch search, and pagination.
   Export Excel and PDF and compare all filtered records and metadata.
8. Log in as two traders. Verify each report returns only that trader's sales,
   purchases and filter options. Confirm direct Finance report calls are denied.
9. Check existing P&L, Reports hub, Trader/Execution ledgers, invoice approvals,
   warehouse movements, and the voucher funding/settlement workflow.

## Rollback and deployment

All changes are additive reporting/UI code plus route redirects. No database
migration is required. Reverting the feature commit restores the old navigation
and pages without data conversion. Complete smoke tests before merge/deployment.

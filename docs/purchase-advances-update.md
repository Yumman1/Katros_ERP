# Builty-linked Sesame purchase advances

This update builds on the unpushed warehouse/processing update. Apply the combined package once; do not apply the previous package first.

## Workflow

1. Execution → Vouchers → Purchase: select an open, locked external Pakistan Sesame trade. Its payment terms determine the read-only advance percentage. For `80% Advance`, this is 80%; for `20% After Delivery`, this is also 80%. Credit/LC trades without advance terms keep their existing workflow.
2. Enter advance weight **in kg**, numeric builty number and transporter. The amount defaults to weight × locked contract rate × advance percentage. Editing the amount overrides it; “Use calculated amount” restores calculation. The calculated amount and percentage are saved for audit and shown to finance.
3. Finance approves the voucher. The existing BUY credit convention is retained. Pending/rejected advances cannot fund a truck. One active advance voucher is allowed per trade/builty.
4. On the public gate-in form, choose supplier/commodity, then the advance trade and its approved builty. This fills transporter and expected seller weight. A builty can be claimed by only one truck. Non-advance gate entries still work.
5. Execution records actual warehouse weight and locks the truck with its quality deduction in kg. The advance builty must be assigned to its original trade, as one receipt. Net received kg determine fulfillment and the expected payable.
6. Enter the full supplier invoice amount and invoice number. The screen shows the advance, the dynamic remaining percentage from the terms, and the actual outstanding amount. Existing invoice matching and trader approval still apply.
7. Trader approval applies the approved advance once. Finance receives only the actual remaining balance. The request and ledger identify builty, invoice and advance voucher. Approval creates a separate payment credit. The original voucher shows **Paid** only when the truck is fully covered; merely approving the advance does not mark the truck paid.
8. If the advance exceeds the final payable, the original voucher displays the excess after that truck is settled. Choose **Adjust excess with future truck**, select an invoiced truck, and enter the amount. This reuses existing money without a new cash entry. It requires the same supplier, commodity and trading entity and cannot exceed either balance. The original voucher lists where its money was applied.

## Accounting and safeguards

- Actual outstanding = final net payable minus advance allocations and approved final payments. “20% remaining” is a terms label, not an instruction to pay 20% despite different received weight or an overridden advance.
- A 10,000 advance for expected 40 MT is reconciled to the rate × actual net received quantity; any excess is retained until explicitly allocated. There is no automatic refund or silent transfer.
- Voucher/truck/receipt row locks, database uniqueness and positive-allocation constraints protect claims and spending. Payment approval is atomic with the ledger credit; repeated approvals do not pay twice.
- Applied advances prevent invoice/receipt edits that could erase their accounting basis. Finance-pending requests must be resolved before allocating additional carried credit to that receipt.
- Ordinary Corn, sales vouchers, settled-trade vouchers, internal Sesame ownership and existing gate flows remain available.

## Deployment

Apply both incremental Prisma migrations in the combined package with `npm run db:migrate`. Do not use `db:push` for this deployment: the active-builty partial unique index and allocation constraints are part of the SQL migration. No production database changes or Git push were performed while preparing this package.

## Verification

- TypeScript and production Next.js build.
- ESLint (existing image/hook warnings remain).
- Isolated PostgreSQL-compatible integration tests using the actual Prisma service/router paths: 80% calculation; manual override; percentage snapshots after changing terms to 90%; gate claim/retry; short weight and quality deductions; remaining payment approval; separate ledger credits; paid status; excess reuse; cross-entity rejection; overspend rejection.
- Re-ran processing and ownership integration suites with both migrations applied, including all three processing routes, internal gates, impurity exclusion, FZCO ownership/reservations and Corn isolation.
- No browser walkthrough or production database test is claimed.

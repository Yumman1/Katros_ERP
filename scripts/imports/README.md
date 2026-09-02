# Corn Summer Purchase import

Run these **in numbered order** against the target database. The second file
updates rows the first one creates, so running it alone does nothing and
running it first silently leaves every hold unapplied.

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01-corn-summer-purchase-data.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 02-corn-summer-purchase-holds.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 03-corn-summer-purchase-rate-fix.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 04-reseed-ref-counters.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 05-corn-summer-payment-reconciliation.sql
```

| File | What it does |
| --- | --- |
| `01-corn-summer-purchase-data.sql` | Trades, contracts, trucks, gate invoices and inbound receipts from the workbook. |
| `02-corn-summer-purchase-holds.sql` | Payment holds, split per truck. Sets each receipt's paid amount and each truck's gate-invoice stage. |
| `03-corn-summer-purchase-rate-fix.sql` | Restores the quoted ₨/maund rate in `Trade.price` (the bulk load stored the per-MT figure twice). |
| `04-reseed-ref-counters.sql` | Moves `RefCounter` past the reference numbers the load carried, so the app stops re-issuing refs that already exist. Run last, after **any** bulk load. |
| `04-corn-summer-excel-reconciliation.sql` | Aug 2026 trade qty/close fixes and missing KCS-424 (separate from ref reseed). |
| `05-corn-summer-payment-reconciliation.sql` | Clears Payment Release rows stuck in trader/finance queues; marks historical receipts PAID. Run after 02. |
| `06-corn-summer-missing-sales.sql` | Missing Execution workbook sale contracts (SAL-0003–0007) + outbound dispatches. Regenerate with `npx tsx scripts/generate-missing-sales-sql.ts`. |

Both are idempotent — re-running sets the same absolute values rather than
accumulating, so a partial or repeated run is safe to redo from the top.

## Why the holds are a separate step

The workbook records a hold once against a whole gate invoice ("1.1M hold /
Remain released"), but an invoice covers several trucks and the money model
holds against a truck. Splitting that group figure into per-truck shares is a
judgement the bulk data file has no room to express, so it lives on its own with
the arithmetic written out and checkable. See the header of file 02.

## What the import deliberately does not create

Payments in this workbook already happened, so the import writes each receipt's
paid amount directly instead of replaying the live pipeline (trader approves →
finance pays). That means no `PaymentRequest` rows and no buy-ledger `CREDIT`
rows for imported history — matching how the buy side reads: a payable is billed
by its gatepass debit and settled by its receipt being paid, never by a credit
row. Money still owed on an imported truck is released through the normal
trader-approval flow from here on.

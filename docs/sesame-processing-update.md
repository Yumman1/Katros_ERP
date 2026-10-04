# Sesame processing and internal truck update

Based on master commit b4b0b7fedda89ee04e3ba7e317a98bea7d8b92de.

## Included

- Internal/external trade selection is immediately above Counterparty in Book Trade.
- Execution can enter a manual quality deduction in kg when assigning/locking a received inbound truck. Zero is allowed; negative, non-finite, and deductions consuming the entire load are rejected. The deduction and assignment are saved atomically. Stock fulfilment uses net received weight even if an invoice was entered earlier.
- Lease payment reminder appears in the execution dashboard when a lease reaches halfway, including overdue leases. Lease start date and period remain editable in Warehouses → Update & delete. Use-basis warehouses are excluded. Acknowledgement dismisses the popup for the current dashboard visit; changed dates recalculate the reminder.
- Processed Goods appears below Internal Shifting on the Pakistan Sesame desk. Raw → Machine Cleaned, Raw → Sortex, and Machine Cleaned → Sortex are supported.
- Truck Movements has External/Internal options. Internal movements use separate records and INT-prefixed gate references. Dedicated internal gate pages and per-truck shareable links are available in Internal Shifting / Internal Trucks.
- Warehouse and booking views show Raw, Machine Cleaned, Sortex, and Impurities. Processing preserves total physical stock: input = output + impurities. Warehouse utilization includes all four types. Unassigned gate receipts occupy space but remain explicitly unclassified until matched to a trade.
- Trader and execution positions exclude impurities. Existing use-basis capacity behavior remains unchanged.

## Processing workflow

1. Register the processing warehouse, using lease or use basis as appropriate.
2. Under Truck Movements → Internal, book a shift with purpose **Send for processing**, select the input grade, source, destination, quantity and truck.
3. Record internal gate out. Stock leaves the source and remains in transit until gate in.
4. Record internal gate in at the processing warehouse, using its measured weight.
5. Open Processed Goods, choose the received truck, conversion, input kg and yield ratio. **0.98 means 98%.** For 100 kg, output is 98 kg and impurities are 2 kg.
6. If goods return, create an internal shift for the output grade. Impurities stay where recorded until separately shifted.

Processing cannot exceed the truck's unprocessed received quantity or the available input grade. Repeated submissions with the same request key do not process twice. FZCO custody and reserved stock are protected. Received movements cannot be cancelled to recreate stock.

Legacy transfers without a saved grade retain the previous default, Machine Cleaned. No historical quantities are rewritten. Historical trades use their saved Sesame type; legacy trades missing a type use the existing Machine Cleaned default.

## Install and push

Use PowerShell in your existing Katros_ERP checkout with its database environment already configured. Save Katros_Processing_Update.zip in Downloads. Finish or commit any unrelated local edits before applying the patch.

```powershell
git switch master
git pull --ff-only origin master
Expand-Archive "$env:USERPROFILE\Downloads\Katros_Processing_Update.zip" "$env:USERPROFILE\Downloads\Katros_Processing_Update" -Force
git apply --check "$env:USERPROFILE\Downloads\Katros_Processing_Update\Katros_Processing_Update.patch"
git apply "$env:USERPROFILE\Downloads\Katros_Processing_Update\Katros_Processing_Update.patch"
npm ci
npm run db:migrate
npm run build
git add -- (Get-Content "$env:USERPROFILE\Downloads\Katros_Processing_Update\changed-files.txt")
git commit -m "Add sesame processing, internal trucks, deductions and lease reminders"
git push origin master
```

Stop if any command reports an error; do not skip a failed patch or migration. Apply the database migration before the updated deployment starts serving traffic. This is an additive Prisma migration; never run db:reset or db:push for this update.

The ZIP includes the same migration as a standalone SQL file for review, but apply it through `npm run db:migrate` so Prisma records it. Do not apply both the SQL manually and the Prisma migration.

## Verification

- TypeScript and production compilation/build.
- 18 focused tests for yield/mass balance, lease midpoint and date editing, warehouse display, use-basis and Sesame regressions.
- Isolated PostgreSQL-compatible database: baseline schema plus the new migration, all three conversions, gate transitions, duplicate submissions, excessive processing, output return, position exclusion of impurities, and no external movement creation.
- Existing FZCO integration checks: physical receipts, internal ownership, protected custody, payments, truck release, cancellations, reverse ownership, and Corn isolation.
- Live production data and migrations have not been changed by this package.

# Warehouse processing and trader update

## Included

- Sesame price-unit dropdown includes MT, KG, 40 kg Maund and 37.324 kg Maund. Known unit factors are checked on the server. Net rate after commission is visible before booking.
- Payment categories are general, with percentage/credit days entered separately. Trade filters and Corn counterparty reporting can filter by payment category.
- Faqir Warehouse is excluded from new Sesame selections and movements; its master record and history remain intact for other commodities.
- Purchase advance payments and final payments display as supplier-account debits, and their invoice displays as a credit. The underlying legacy settlement signs are retained so existing funding and reconciliation rules are not changed.
- All traders can view commodity positions. Editing rates remains restricted to assigned commodities.
- Processing uses warehouse inventory, not trucks. Each batch reserves stock after booked sales, ownership and existing reservations. Daily cleaned/Sortex output plus impurities determines input consumed and yield. Multiple runs and conversions are supported.
- Daily capacity and expected yield are editable defaults. Actual inventory is updated when daily output is submitted, not by an unattended midnight posting of estimated production.
- Forecasts use the most recent 90 days' weighted yield and average input per calendar day, including idle days since the first recorded production date. Before records exist, planned capacity/yield is used. Forecast quantities are capped by remaining batch inventory.
- Remaining reservations can be released without deleting completed production. Impurities and locked processing quantities are visible in warehouse inventory; impurities remain excluded from positions.

## Deployment

Apply the supplied patch on master. Run `npm run db:migrate` against the intended deployment database before deploying the new code, then `npm run build`, commit the supplied changed-files list and push master. Do not use `db:push` or reset commands.

New migration: `20261006010000_warehouse_processing`. Adds processing plans and optional links from daily production records, preserving historical truck-based records. No live database migration was performed for this update.

## Price reconciliation

KAS-2026-113 was booked at PKR 11,000/MT including PKR 5/MT commission. Net rate is PKR 10,995/MT = PKR 10.995/kg. Its 80% advance on 200,000 kg is PKR 1,759,200. Warehouse weight of 199,800 kg less 200 kg deductions gives 199,600 payable kg, valued at PKR 2,194,602. Remaining payment is PKR 435,402. These amounts reconcile and were not repriced.

## Verification

Isolated-database tests cover conversions, commission, payment terms, Faqir exclusion, stock reservations, sales blocking, concurrent batch reservation, all three routes, daily yields, mass conservation, forecasts, retries and access restrictions. Existing purchase-advance workflow regression tests passed. Browser verification was attempted but the browser runtime could not start; no visual-browser pass is claimed.

# Commodity dashboards and Sesame booking

Built on the CEO assignment feature in `f860a85`. No Prisma schema change or new migration is required.

## Access and dashboards

- Trader navigation lists only commodities currently assigned by the CEO. A trader with several assignments switches between commodity dashboards.
- Dashboard totals, action items, exposure, trade lists, cancelled counts, unfinished drafts, positions, fulfillment, sales reports and monthly locked-trade exports follow the selected commodity.
- Booking checks the enabled trader and current assignment on the server. Assignment changes refresh every 30 seconds and when the window regains focus; unauthorized requests are rejected immediately by the server.
- Unassigned traders can still request a commodity for CEO approval.
- Existing trade authorship and approval ownership are preserved. Transferring a commodity changes the available desk and future booking permission; it does not rewrite historical trades to another author. Company-wide ledger alerts are explicitly labelled; existing approval queues and counterparty registers remain account-level workflows.
- Sesame registration and Saad's initial assignment continue to use the existing CEO approval logic. This update does not create a commodity or counterparties.

## Sesame terms

- Processing types: Machine Cleaned, Raw, CNF, Sortex, Impurities.
- Specs default to Purity 99%, FFA 2%, Moisture 7%, Oil Content 49%, Admixture 1%. They are editable percentages validated between 0 and 100.
- Sortex alone shows a free-text Color field. Changing away from Sortex removes the saved color and quality-summary entry.
- Trade route is Local or Dubai, independent of the Local/International market.
- Advance and After Delivery accept a percentage greater than zero and at most 100. Credit keeps its existing editable days. Legacy payment enum values remain compatible; `paymentPercentage` and the rendered `paymentTerms` hold the actual percentage.
- `tradeParams` stores the processing type, route, quality values, color and payment percentage. Autosaved drafts, booked trades, trader edits, execution details, CEO edit previews and exports preserve/display these values.
- Sesame has no crop-season booking control or trade-detail label. The existing non-null season column uses its single SUMMER compatibility bucket internally; Corn retains its existing WINTER/SUMMER books. Sesame net-position labels omit the season suffix.

## Verification

`node --import tsx scripts/check-sesame.ts` runs against an **empty, disposable local PostgreSQL database named `sesame_test`**, initialized from the current Prisma schema. It deliberately refuses non-local databases and databases with existing users. Never use the production database for this script.

The checks cover actual database/API booking, draft persistence, edit persistence, all five types, hidden-color removal, independent route/market fields, invalid terms, percentage labels, Corn seasons/credit days, multi-commodity isolation, CEO-only transfer, revoked booking access and disabled traders. TypeScript and lint are also checked separately.

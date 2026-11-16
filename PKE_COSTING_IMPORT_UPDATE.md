# PKE costing and import navigation update

Based on repository commit 76f3385.

- Finance Policies now controls customs duty, additional customs duty, regulatory duty, sales tax, additional sales tax, income tax and additional income tax.
- Pakistan PKE Execution / Costing Estimate controls infrastructure cess, insurance, landing allowance, wharfage, surveyor, clearance, fumigation, terminal handling, bags, transport, storage, delivery and estimated exchange rate.
- Execution can change expense rates and expense totals within the breakdown. Calculations update immediately. Save execution defaults persists changed inputs for subsequent estimates and trade-booking previews; Reset estimate discards unsaved overrides.
- Department-specific API validation prevents cross-department rate changes. Partial updates merge under a database row lock, preserving the other department's settings.
- Import Files filters by supplier purchase trade. Click a trade to open its existing file or start its first file. Add BL creates another shipment under the same trade. No manual name is required. Existing records, documents and approvals remain available.
- Dubai continues to manage only its supplier LCs. Pakistan retains its existing import responsibilities.

No schema changes, migrations, data resets or credential changes are required.

Validation: six costing tests passed; TypeScript check passed. Authenticated browser and live database workflows were not exercised in this environment. The normal build's external Google Fonts download was unavailable; compilation was checked with a temporary local font response that is not included in this patch.

Apply the ZIP's contents over the repository root. It contains only changed source files and this note, not environment files or dependencies. Run npm run build in your normal environment before committing/pushing.

# Trader dashboard widgets and fulfillment filters

Based on master 3e37e9e, including the CEO and Sesame work. No schema migration or live data changes.

Fulfillment (Corn, Sesame and future commodities) removes Search records, Commodity, Trade date and Counterparty filter controls. Trade-card details and delivery filters remain. MTM: highest to lowest sorts the existing converted USD MTM, places missing conversions last, and displays the value on each card. The filter state version changes so obsolete saved selections do not hide records.

My Desk includes Edit widgets, live preview, Save, Cancel and Restore defaults. All existing panels remain available except Pending confirmation. Added Total bought, Inventory, Total sold and MTM by commodity. Preferences are keyed by user ID and commodity ID in local browser storage; they survive refreshes but do not sync across devices. If storage is blocked, the interface explains that changes apply only for the current visit. An empty layout still offers Edit widgets.

Metric definitions:
- Total bought/sold: the trader's cumulative physical trade quantity in MT for the selected commodity, including LOCKED, CONFIRMED, EXECUTED and non-cash-only SETTLED records. Drafts, cancelled contracts and cash-only settlements are excluded.
- Inventory: the selected commodity's warehouse stock from the existing Positions calculation, summed across seasons. Includes existing receipt/dispatch and external transfer rules; it is commodity stock, not a trader-specific ownership allocation.
- MTM by commodity: existing open locked/confirmed USD MTM for the selected commodity. Missing FX is shown as unavailable instead of zero or a native-currency value labelled USD. Switch desks to see another commodity.

Checks: targeted totals, MTM ordering, removed-filter behavior, existing record-filter regression tests, preference validation and isolation; TypeScript, production build and the database-backed Sesame/Corn/CEO assignment regression script.

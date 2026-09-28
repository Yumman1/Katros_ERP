# Commodity execution dashboards

All execution employees can select any registered commodity in the execution sidebar. Corn is the initial desk. Sesame uses the existing purchase, spot, sale, truck, approval, inventory, position, voucher, ledger and export workflows. Existing department-head and finance approval permissions still apply.

Each desk has a separate query cache and commodity-scoped API requests. Opening a trade or truck print link selects the record's commodity. Switching from a record opens the new desk overview. Counterparty and warehouse master records remain shared.

## Ledger and pricing

Vouchers carry a commodity code. A trade-linked voucher inherits its trade's commodity; a direct advance inherits the selected execution desk. Ledger totals and available truck funding are calculated within that commodity, so corn credit cannot pay a sesame truck. Finance can still view consolidated accounts.

The existing execution payment workflow settles amounts in PKR. For USD sesame trades, set the USD/PKR rate for the trade's season in Positions before locking. Locking captures the rate in the trade and converts the execution contract's per-kg rate to PKR. Later market changes do not reprice the contract. Original quotation currency and commission-inclusive booking fields remain available. Corn pricing is unchanged.

## Deployment

Apply migration `20260927210000_execution_commodity_desks` before releasing the new app:

```sh
npm ci
npm run db:migrate
npm run build
```

Use the existing deployment database environment variables. The migration adds `Voucher.commodityCode` and an index. Existing linked vouchers inherit their trade commodity. Historical unlinked advances are attributed to CORN/CRN, the previous execution desk. It does not rewrite historical payment amounts or FX rates.

## Verification

- Production build and TypeScript validation passed.
- Lint passed for modified execution components and routers; the full build reports existing warnings in branding and warehouse allocation components.
- 27 existing sesame, funding, ledger-note and voucher tests passed.
- Disposable database checks passed for two ordinary execution employees, scoped queues, cross-desk write rejection, permission checks, FX snapshotting, inbound allocation, commodity inventory, vouchers, separate credit pools and exports.
- Migration backfill checked with corn, sesame and historical advance vouchers.
- Browser checks cover member login, commodity switching, selected-desk persistence and sesame ledger loading.
- Full outbound assignment/DO/release integration is included in `scripts/check-execution-desks.ts`, but was not completed in the disposable PGlite environment because it cannot support the existing workflow's concurrent independent transactions. Run this check on an empty local PostgreSQL database on port 55433 with the current schema. Do not use a production database. `EXECUTION_TEST_SKIP_OUTBOUND=1` skips only that unsupported segment for PGlite.

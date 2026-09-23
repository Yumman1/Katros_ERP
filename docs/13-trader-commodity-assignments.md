# Trader commodity assignments — CEO phase

## Included

- CEO → Users displays every commodity assigned to a trader.
- CEO → Trader commodities assigns, transfers or unassigns a commodity. One commodity has one current trader; each trader may hold multiple commodities.
- Only an enabled user whose current database role is CEO can change assignments. Legacy ADMIN accounts and stale CEO sessions do not pass this check.
- Registered commodities without an owner are marked Unassigned. Disabled owners remain visible, with an unavailable warning, until the CEO transfers them.
- Role changes are blocked while the user owns commodity assignments. Disabling an account keeps its assignments visible for transfer.
- CEO approval creates the commodity, preserves the requesting user's ID, records ownership and resolves the approval in a single transaction. Failed registrations remain pending. The old department endpoint also enforces this CEO-only workflow.
- The Users list and assignment page refresh after relevant mutations; assignment reads do not rewrite ownership. Version checks reject stale concurrent edits.

## Database and rollout

Apply `prisma/migrations/20260923150000_trader_commodity_assignments/migration.sql` before deploying the new code:

```bash
npm run db:migrate
npm run db:generate
```

These commands require the existing deployment database connection variables in the local `.env`. This delivery has not modified the live database or pushed/deployed the application.

`CommodityTraderAssignment` stores `commodityId` (primary key), nullable `traderId`, nullable `changedById`, `source`, `version` and `updatedAt`. Foreign keys reference the existing Commodity and User records. RLS is enabled without public Data API policies, matching server-only Prisma access.

The migration links existing Corn/CRN commodities to `fahad.ahmed@kastros.co` and existing Sesame/SES commodities (or commodities named Sesame / Sesame Seed / Sesame Seeds) to `saad.bashir@kastros.co`, provided those enabled trader accounts exist. Other commodities start unassigned. It creates no users or commodities. Missing accounts can be created/enabled and assigned by the CEO.

If Sesame has not been registered, its later CEO approval links it to Saad. Other new commodities go to the requesting trader (Corn retains its initial Fahad link). These defaults only apply on registration, never after a CEO transfer or unassignment. Commodity deletion cascades its assignment record through the foreign key; existing trade-history deletion restrictions remain in place.

Existing historical trades are not reassigned. This phase stores the current desk ownership; trader dashboard selection and data filtering will be wired in the next phase.

## Verification

- TypeScript `tsc --noEmit`.
- Targeted ESLint on changed TypeScript/TSX files.
- New migration applied against the prior schema using an isolated PGlite PostgreSQL-compatible test database.
- 17 database/API checks: migration default links, RLS, multiple commodities per trader, transfer visibility, stale edits, persistent unassignment, role authorization, disabled/non-trader targets, role-change guard, atomic approval, double approval, rollback on duplicate code, rollback on disabled requester, rejection, department endpoint authorization, future Sesame assignment and persistent CEO override.
- No live-database or browser verification was performed. Parallel transaction behavior was guarded in code but not load-tested against live PostgreSQL.

## Next phase — trader UI (not implemented in this delivery)

- Separate commodity dashboards selected from persisted trader assignments; transfers update the trader's available dashboard.
- Sesame Book a trade: omit season; add Machine Cleaned, Raw, CNF, Sortex and Impurities dropdown options.
- Editable payment percentages alongside the existing editable credit days.
- Sesame specs: Purity 99%, FFA 2%, Moisture 7%, Oil Content 49%, Admixture 1%.
- Sortex only: free-text color in specifications (no dropdown).
- A separate routing dropdown: Dubai or Local. Keep this distinct from the existing local/international market selection.
- Additional Sesame counterparties will be supplied later.

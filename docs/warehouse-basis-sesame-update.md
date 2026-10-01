# Sesame warehouse basis update

This update adds `LEASE` / `USE` to warehouse registration, management, approval payloads, and shared trader/execution availability.

- Lease basis requires positive floor area. Existing capacity and storage-division calculations remain available.
- Use basis needs no area or grain/bale divisions. Those fields are cleared when converting a warehouse to use basis. Incoming allocation stays selectable; confirm space by phone before storing inventory.
- Use-basis utilization is reported as 100% by convention, not as a capacity constraint. Buy allocation shows a phone-confirmation reminder; sell allocation still uses physical stock, booked quantities and free-to-sell quantities.
- Physical occupancy includes all commodities sharing the floor, including unassigned receipts and stock transfers. FZCO ownership does not create extra physical stock; Pakistan free-to-sell continues to deduct FZCO custody.

## Warehouse registration migration

| Warehouse | Basis | Location | Area (sq ft) | Grain division (sq ft/MT) |
|---|---|---|---:|---|
| Gama WH | Lease | Vehari, Punjab | 47,000 | Preserve existing; otherwise requires confirmation |
| Umar WH | Lease | Tiba Sultan Pur, Punjab | 37,000 | Preserve existing; otherwise estimate 9.01 |
| Silver WH | Lease | Port Qasim, Sindh | 20,000 | Preserve existing; otherwise estimate 6.24 |
| MA oil | Use | Port Qasim, Sindh | Not applicable | Not applicable |

The migration recognises WH/Warehouse aliases, K-code prefixes and Umar/Umer, preserving existing IDs and names. Existing division settings are preserved. Fresh database seed data includes the four locations too. Do not run the full seed on production to apply this update; use the migration.

## Source limitations

Source: warehouse utilization summary dated 25 September 2026.

- Silver: `20,000 × 84% ÷ 2,692 = 6.2407`, rounded to 6.24.
- Umar: `37,000 × 69% ÷ (2,583 + 250) = 9.0116`, rounded to 9.01. This assumes corn and sesame use the same warehouse grain division, consistent with the existing shared-grain model.
- Gama: `594 × grainDivision + 218 × cottonDivision ≈ 47,000 × 24%`. There are two unknown division factors. Without a confirmed cotton or grain factor, a unique grain division cannot be calculated. A new Gama record remains selectable but utilization/available capacity stays unconfigured until execution enters the verified division(s) in Warehouses → Update & delete.
- Sheet utilization percentages are rounded, so the inferred divisions are estimates, not measured densities.
- The snapshot quantities (12, 250, 2,692 and 1,991 MT) are not loaded as current stock. Doing so would risk double-counting receipts already in the ledger or replacing movements since 25 September. Live stock continues to come from the transaction ledger.

## Apply and push (PowerShell)

Open PowerShell in your existing Katros_ERP checkout, where your database environment variables are configured. Download and extract Katros_Sesame_Warehouses.zip to Downloads\Katros_Sesame_Warehouses.

```powershell
git switch master
git pull --ff-only origin master
git apply --check "$env:USERPROFILE\Downloads\Katros_Sesame_Warehouses\Katros_Sesame_Warehouses.patch"
git apply "$env:USERPROFILE\Downloads\Katros_Sesame_Warehouses\Katros_Sesame_Warehouses.patch"
npm ci
npx prisma migrate deploy
npx tsc --noEmit
git add -- (Get-Content "$env:USERPROFILE\Downloads\Katros_Sesame_Warehouses\changed-files.txt")
git commit -m "Add lease and use basis warehouses for sesame"
git push origin master
```

Run each command only if the preceding command succeeds. Apply the migration to the production database before the new application deploys. Existing POSTGRES_PRISMA_URL and POSTGRES_URL_NON_POOLING configuration is required; no credentials are included. The migration is additive and leaves stock/trade records untouched.

## Verification

- Production build: `npm run build` passed (existing unrelated image/hooks/chart warnings).
- TypeScript: `npx tsc --noEmit` passed.
- Focused regression tests: `node --import tsx --test lib/warehouse-basis.test.ts lib/warehouse-availability-display.test.ts` (9 tests).
- Migration executed against disposable PostgreSQL (PGlite), checking record creation, alias matching, preserved IDs, preserved division factors, unchanged linked inventory, nullable use-basis capacity and duplicate-free repeated registration.
- Live production database changes and authenticated production UI checks have not been performed in this environment.

# Kastros CTRM

Commodity Trading and Risk Management platform — Next.js 14, tRPC, Prisma, mock-first execution runtime.

## Quick start

```bash
cd kastros-ctrm
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Mock login password: `demo` or `Kastros123!`.

## Full recreation documentation

**Start here:** [docs/README.md](./docs/README.md)

Structured specs for rebuilding the entire application — data model (ERD), trade lifecycle, execution profiles, warehouse/gatepass, approvals, formulas, API reference, UI routes, and persistence.

| Doc | Topic |
|-----|-------|
| [docs/01-architecture.md](./docs/01-architecture.md) | System architecture |
| [docs/02-data-model.md](./docs/02-data-model.md) | Prisma + mock runtime |
| [docs/03-auth-and-roles.md](./docs/03-auth-and-roles.md) | Auth & RBAC |
| [docs/04-trade-lifecycle.md](./docs/04-trade-lifecycle.md) | Draft → close |
| [docs/05-execution-profiles.md](./docs/05-execution-profiles.md) | Physical pipelines |
| [docs/06-warehouse-and-gatepass.md](./docs/06-warehouse-and-gatepass.md) | Warehouse & gate |
| [docs/07-approvals-workflow.md](./docs/07-approvals-workflow.md) | Change requests |
| [docs/08-formulas-and-calculations.md](./docs/08-formulas-and-calculations.md) | Business math |
| [docs/09-api-reference.md](./docs/09-api-reference.md) | tRPC & REST |
| [docs/10-ui-routes-and-components.md](./docs/10-ui-routes-and-components.md) | Pages & UI |
| [docs/11-persistence-and-seeding.md](./docs/11-persistence-and-seeding.md) | JSON & seeds |

## Local data

Mock persistence: `data/local/*.json` — see [docs/11-persistence-and-seeding.md](./docs/11-persistence-and-seeding.md).

Reset: `npm run data:reset`

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run data:reset` | Clear local JSON stores |
| `npm run db:seed` | Seed PostgreSQL |

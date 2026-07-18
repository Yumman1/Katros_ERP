# Kastros CTRM

Commodity Trading and Risk Management platform — Next.js 14 + tRPC on **Vercel**, PostgreSQL + file Storage on **Supabase** (Prisma 5).

## Quick start (local)

```bash
cp .env.example .env   # fill in Supabase credentials (see docs/12)
npm install            # runs prisma generate
npm run db:seed        # idempotent demo users + master data
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Login: `admin@kastros.com` / `Kastros123!` (see [docs/12](./docs/12-supabase-vercel-deployment.md) for all role accounts).

## Deployment

**Read:** [docs/12-supabase-vercel-deployment.md](./docs/12-supabase-vercel-deployment.md) — architecture, Supabase project details, Vercel environment variables, concurrency model, and the relationship graph.

## Documentation

**Start here:** [docs/README.md](./docs/README.md)

| Doc | Topic |
|-----|-------|
| [docs/01-architecture.md](./docs/01-architecture.md) | System architecture |
| [docs/02-data-model.md](./docs/02-data-model.md) | Data model (see also `prisma/schema.prisma`) |
| [docs/03-auth-and-roles.md](./docs/03-auth-and-roles.md) | Auth & RBAC |
| [docs/04-trade-lifecycle.md](./docs/04-trade-lifecycle.md) | Draft → close |
| [docs/05-execution-profiles.md](./docs/05-execution-profiles.md) | Physical pipelines |
| [docs/06-warehouse-and-gatepass.md](./docs/06-warehouse-and-gatepass.md) | Warehouse & gate |
| [docs/07-approvals-workflow.md](./docs/07-approvals-workflow.md) | Change requests |
| [docs/08-formulas-and-calculations.md](./docs/08-formulas-and-calculations.md) | Business math |
| [docs/09-api-reference.md](./docs/09-api-reference.md) | tRPC & REST |
| [docs/10-ui-routes-and-components.md](./docs/10-ui-routes-and-components.md) | Pages & UI |
| [docs/11-persistence-and-seeding.md](./docs/11-persistence-and-seeding.md) | Persistence (historical — superseded by docs/12) |
| [docs/12-supabase-vercel-deployment.md](./docs/12-supabase-vercel-deployment.md) | **Supabase + Vercel deployment** |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server |
| `npm run build` | Production build (`prisma generate` + `next build`) |
| `npm run db:seed` | Seed Postgres (users, commodities, warehouses, counterparties) |
| `npm run db:migrate` | Apply pending Prisma migrations (`prisma migrate deploy`) |
| `npm run data:reset` | Truncate operational tables (trades, execution, approvals) |

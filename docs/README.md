# Kastros CTRM — Full Recreation Documentation

This folder is the **single source of truth** for rebuilding Kastros CTRM from scratch. It is written for developers and AI agents: explicit enums, formulas, state machines, API procedures, and data shapes.

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| UI | React 18, Tailwind CSS 3, lucide-react |
| API | tRPC 11 + superjson |
| Auth | NextAuth 4 (credentials JWT) |
| ORM | Prisma 5 → PostgreSQL |
| Forms | react-hook-form + Zod |
| Charts | recharts |
| Runtime (dev default) | Mock mode + JSON disk persistence |

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `MOCK_MODE` / `SKIP_DATABASE` | Use mock stores + JSON files | `true` in dev |
| `DATABASE_URL` | PostgreSQL connection | required for DB mode |
| `LOCAL_PERSIST` | Write mock data to disk | `true` when mock |
| `LOCAL_DATA_DIR` | Override data directory | `{cwd}/data/local` |
| `NEXTAUTH_SECRET` | JWT signing | required |
| `NEXTAUTH_URL` | Auth callback base URL | `http://localhost:3000` |

## Recommended rebuild order

1. **Project scaffold** — Next.js, Tailwind, tRPC, Prisma, NextAuth
2. **Prisma schema** — [02-data-model.md](./02-data-model.md)
3. **Auth & roles** — [03-auth-and-roles.md](./03-auth-and-roles.md)
4. **Mock persistence** — [11-persistence-and-seeding.md](./11-persistence-and-seeding.md)
5. **Domain libs** — [08-formulas-and-calculations.md](./08-formulas-and-calculations.md), `lib/trade-constants.ts`
6. **Trader book** — `MockTraderTrade`, `bookTrade`, draft/submit flows
7. **Execution runtime** — `ExecutionContract`, lock, fulfillment
8. **Gatepass REST API** — [06-warehouse-and-gatepass.md](./06-warehouse-and-gatepass.md)
9. **Approvals** — [07-approvals-workflow.md](./07-approvals-workflow.md)
10. **UI shells & routes** — [10-ui-routes-and-components.md](./10-ui-routes-and-components.md)
11. **Dashboard routers** — positions, MTM, inventory, reports
12. **Finance & polish** — payment approvals, exports, layout scroll

## Documentation index

| Doc | Contents |
|-----|----------|
| [01-architecture.md](./01-architecture.md) | System diagram, dual persistence, folder layout |
| [02-data-model.md](./02-data-model.md) | Prisma ERD, mock runtime types, JSON schemas |
| [03-auth-and-roles.md](./03-auth-and-roles.md) | Roles, departments, tRPC guards |
| [04-trade-lifecycle.md](./04-trade-lifecycle.md) | Draft → lock → fulfill → close |
| [05-execution-profiles.md](./05-execution-profiles.md) | PURCHASE_DELIVERED, PURCHASE_SPOT, SALE_EX_WAREHOUSE |
| [06-warehouse-and-gatepass.md](./06-warehouse-and-gatepass.md) | Allocation, gate register, gatepass API |
| [07-approvals-workflow.md](./07-approvals-workflow.md) | Change requests, CEO queue, apply payloads |
| [08-formulas-and-calculations.md](./08-formulas-and-calculations.md) | All business math |
| [09-api-reference.md](./09-api-reference.md) | tRPC + REST procedure catalog |
| [10-ui-routes-and-components.md](./10-ui-routes-and-components.md) | Pages, shells, components |
| [11-persistence-and-seeding.md](./11-persistence-and-seeding.md) | JSON files, seeds, reset scripts |

## Diagrams

| File | Description |
|------|-------------|
| [diagrams/erd-prisma.mmd](./diagrams/erd-prisma.mmd) | PostgreSQL entity relationships |
| [diagrams/erd-mock-runtime.mmd](./diagrams/erd-mock-runtime.mmd) | Mock operational data flow |
| [diagrams/trade-lifecycle.mmd](./diagrams/trade-lifecycle.mmd) | Trade state machine |
| [diagrams/gatepass-pipeline.mmd](./diagrams/gatepass-pipeline.mmd) | Gatepass → fulfillment |
| [diagrams/approvals-routing.mmd](./diagrams/approvals-routing.mmd) | Approval routing |

## Related files

- [LOCAL_STORAGE_SETUP.md](../LOCAL_STORAGE_SETUP.md) — legacy execution JSON notes
- [prisma/schema.prisma](../prisma/schema.prisma) — schema source of truth
- [server/routers/_app.ts](../server/routers/_app.ts) — tRPC root router

## Recreation checklist

- [ ] Prisma schema + migrations applied
- [ ] NextAuth credentials + role in JWT/session
- [ ] Mock mode + `local-persist.ts` + all JSON stores
- [ ] `MockTraderTrade` book + lock promotion to `ExecutionContract`
- [ ] Three execution profiles + spot state machine
- [ ] Gatepass REST + pending truck assignment
- [ ] Change request store + head/CEO resolution + apply
- [ ] All formulas in `08-formulas-and-calculations.md` implemented
- [ ] 17 tRPC routers wired
- [ ] All workspace shells and routes from doc 10
- [ ] Viewport-locked desk layout (`kastros-desk-*`)

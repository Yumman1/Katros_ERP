# 03 — Auth and Roles

---

## Role enum

Source: `prisma/schema.prisma`

| Role | Home route (`lib/routing.ts`) | Workspace |
|------|------------------------------|-----------|
| CEO | `/ceo` | CEO shell |
| ADMIN | `/overview` | Dashboard (all dept powers) |
| TRADER | `/trader` | Trader shell |
| EXECUTION | `/execution` | Execution shell |
| FINANCE | `/finance/payments` | Finance (dashboard shell) |
| RISK_MANAGER | `/positions` | Dashboard |
| READ_ONLY | `/overview` | Dashboard |

Root `/` redirects via `getHomeForRole(session.role)`.

---

## Departments

Source: `lib/departments.ts`

| Department | Roles | Home |
|------------|-------|------|
| EXECUTION | EXECUTION | `/execution` |
| FINANCE | FINANCE | `/finance` |
| TRADING | TRADER | `/trader` |

`departmentForRole(role)` returns null for ADMIN, CEO, RISK_MANAGER, READ_ONLY.

---

## Department head model

```typescript
canActOnDepartment(role, isHead, dept):
  if role === ADMIN → true
  else → isHead && departmentForRole(role) === dept
```

### isHead assignment

| Mode | Rule |
|------|------|
| **Mock** (`server/dummy-data.ts`) | Email contains `"head"` or `"lead"`, OR role ADMIN |
| **Production DB** (`lib/auth.ts`) | Only `ADMIN` or `CEO` get `isHead: true` |

**Note:** No `isHead` column on Prisma User model — production heads are effectively ADMIN/CEO only unless extended.

Session fields: `session.user.role`, `session.user.isHead` (`types/next-auth.d.ts`).

Client hook: `lib/use-team.ts` → `{ role, isHead, department, name }`.

---

## tRPC procedure guards

Source: `server/trpc/trpc.ts`

| Guard | Requirement |
|-------|-------------|
| `publicProcedure` | No auth |
| `protectedProcedure` | Valid session |
| `roleProcedure([roles])` | Session role in list |
| `headProcedure(dept?)` | `isHead`; non-ADMIN must match department |
| `ceoProcedure()` | CEO or ADMIN |

---

## CEO powers

```typescript
canActAsCeo(role) = role === CEO || role === ADMIN
```

CEO procedures: `server/routers/ceo.ts` — commodity registry, approval queue, resolveApproval.

Route guard: `components/auth/ceo-access-guard.tsx` on `(ceo)/layout.tsx`.

---

## Auth flow

```
Login (/login) → NextAuth credentials → JWT (role, isHead) → session
Middleware (middleware.ts) → requires token except public paths
AuthBoundary (components/auth-guard.tsx) → client redirect if unauthenticated
```

### Mock login

Password: `demo` or `Kastros123!`  
User derived from email via `mockCredentialsUser(email)` — role inferred from email pattern.

### Production login

bcrypt password vs `User.passwordHash` in PostgreSQL.

---

## Public routes (no auth)

- `/login`
- `/warehouse/gatepass`
- `/api/*` (includes tRPC, NextAuth, gatepass REST, SSE)

Configured in `middleware.ts` and `components/auth-guard.tsx`.

---

## Route vs API protection

Most workspace pages are **not** route-guarded by role — only CEO layout has explicit guard. **Authorization is enforced on tRPC mutations/queries** via `roleProcedure` / `headProcedure`.

Implication for recreation: implement server-side guards even if pages are reachable.

---

## Role → typical procedures

| Role | Primary routers |
|------|-----------------|
| TRADER | `trader.*`, `team.submitChangeRequest`, `team.myChangeRequests` |
| EXECUTION | `execution.*`, `team.*` (head) |
| FINANCE | `finance.*`, dashboard cashflow/reconciliation |
| CEO | `ceo.*` |
| ADMIN | All + headProcedure bypass |
| RISK_MANAGER / READ_ONLY | Dashboard read routers |

---

## Related

- [07-approvals-workflow.md](./07-approvals-workflow.md)
- [10-ui-routes-and-components.md](./10-ui-routes-and-components.md)

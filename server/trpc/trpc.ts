import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";
import type { Role } from "@prisma/client";
import { departmentForRole, type Department } from "@/lib/departments";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** CEO is the top authority — passes every role/head gate. */
function isExecutive(role: Role): boolean {
  return role === "CEO" || role === "ADMIN";
}

const PRESENCE_THROTTLE_MS = 60_000;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  // Presence heartbeat — at most one write per user per minute, fire-and-forget.
  const userId = ctx.session.user.id;
  void ctx.prisma.user
    .updateMany({
      where: {
        id: userId,
        OR: [
          { lastSeenAt: null },
          { lastSeenAt: { lt: new Date(Date.now() - PRESENCE_THROTTLE_MS) } },
        ],
      },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => {
      /* presence is best-effort */
    });
  return next({
    ctx: { ...ctx, session: ctx.session },
  });
});

export function roleProcedure(roles: Role[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    const r = ctx.session.user.role;
    if (!isExecutive(r) && !roles.includes(r)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient role" });
    }
    return next({ ctx });
  });
}

/**
 * Requires the user to be a department head (CEO passes everywhere). When a
 * department is given, a non-executive head must belong to that department.
 */
export function headProcedure(department?: Department) {
  return protectedProcedure.use(({ ctx, next }) => {
    const u = ctx.session.user;
    if (isExecutive(u.role)) {
      return next({ ctx });
    }
    if (!u.isHead) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Head of department access required" });
    }
    if (department && departmentForRole(u.role) !== department) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not the head of this department" });
    }
    return next({ ctx });
  });
}

export function ceoProcedure() {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!isExecutive(ctx.session.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "CEO access required" });
    }
    return next({ ctx });
  });
}

export const mergeRouters = t.mergeRouters;

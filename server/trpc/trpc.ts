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

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { ...ctx, session: ctx.session },
  });
});

export function roleProcedure(roles: Role[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    const r = ctx.session.user.role;
    if (!roles.includes(r)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient role" });
    }
    return next({ ctx });
  });
}

/**
 * Requires the user to be a department head (or ADMIN). When a department is
 * given, a non-admin head must belong to that department.
 */
export function headProcedure(department?: Department) {
  return protectedProcedure.use(({ ctx, next }) => {
    const u = ctx.session.user;
    if (!u.isHead) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Head of department access required" });
    }
    if (department && u.role !== "ADMIN" && departmentForRole(u.role) !== department) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not the head of this department" });
    }
    return next({ ctx });
  });
}

export function ceoProcedure() {
  return protectedProcedure.use(({ ctx, next }) => {
    const r = ctx.session.user.role;
    if (r !== "CEO" && r !== "ADMIN") {
      throw new TRPCError({ code: "FORBIDDEN", message: "CEO access required" });
    }
    return next({ ctx });
  });
}

export const mergeRouters = t.mergeRouters;

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";
import type { Role } from "@prisma/client";

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

export const mergeRouters = t.mergeRouters;

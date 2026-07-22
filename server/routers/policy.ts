import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, roleProcedure, router } from "@/server/trpc/trpc";
import {
  getFinancePolicy,
  getYearlySellInflowByCounterparty,
  updateFinancePolicy,
} from "@/server/finance/policy";
import { fiscalYearLabel } from "@/lib/finance-policy";

/**
 * Company-wide finance policies — the 236G advance tax rate and the yearly
 * counterparty inflow limit. Read by every portal; editable only from the
 * Finance → Policies page.
 */
export const policyRouter = router({
  get: protectedProcedure.query(() => getFinancePolicy()),

  update: roleProcedure(["FINANCE", "ADMIN"])
    .input(
      z.object({
        yearlyInflowLimitPkr: z.number().positive().optional(),
        advanceTaxRatePct: z.number().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateFinancePolicy(
          input,
          ctx.session.user.name ?? ctx.session.user.email ?? "finance",
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update policy",
        });
      }
    }),

  /**
   * Fiscal-year (1 Jul – 30 Jun) booked sale value per SELL-side counterparty
   * vs the policy limit — drives the "Caution: over PKR 200M" tag in the
   * booking counterparty dropdown.
   */
  sellInflowStatus: protectedProcedure.query(async () => {
    const [byCp, policy] = await Promise.all([
      getYearlySellInflowByCounterparty(),
      getFinancePolicy(),
    ]);
    return {
      fiscalYear: fiscalYearLabel(),
      limitPkr: policy.yearlyInflowLimitPkr,
      byCounterparty: Object.fromEntries(byCp),
    };
  }),
});

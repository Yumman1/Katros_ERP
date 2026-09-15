import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { headProcedure, protectedProcedure, router } from "@/server/trpc/trpc";
import {
  getFinancePolicy,
  getYearlySellInflowByCounterparty,
  updateFinancePolicy,
} from "@/server/finance/policy";
import { getOverdueLedgerAlerts } from "@/server/finance/ledger";
import { listRejections } from "@/server/rejections";
import { fiscalYearLabel } from "@/lib/finance-policy";
import { canonicalTraderName } from "@/lib/trader-identity";
import { traderDisplayName } from "@/lib/trader-display-name";
import { prisma } from "@/server/db";

/**
 * Company-wide finance policies — the 236G advance tax rate and the yearly
 * counterparty inflow limit. Read by every portal; editable only from the
 * Finance → Policies page.
 */
export const policyRouter = router({
  get: protectedProcedure.query(() => getFinancePolicy()),

  /** Head of finance only — company tax rates are not a member-level knob. */
  update: headProcedure("FINANCE")
    .input(
      z.object({
        yearlyInflowLimitPkr: z.number().positive().optional(),
        advanceTaxRatePct: z.number().min(0).max(100).optional(),
        advanceTaxRatePctNonFiler: z.number().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const policy = await updateFinancePolicy(
          input,
          ctx.session.user.name ?? ctx.session.user.email ?? "finance",
        );
        // "Applies everywhere immediately": re-derive 236G on every truck
        // still awaiting balance (frozen stages keep their approved amounts).
        if (input.advanceTaxRatePct != null || input.advanceTaxRatePctNonFiler != null) {
          const awaiting = await prisma.pendingTruck.findMany({
            where: { movementType: "OUTBOUND", saleStage: "AWAITING_BALANCE" },
            select: { assignedTradeRef: true },
          });
          const refs = [
            ...new Set(
              awaiting.map((t) => t.assignedTradeRef).filter((x): x is string => Boolean(x)),
            ),
          ];
          const { recomputeTradeLinkedAmounts } = await import("@/server/execution/recompute");
          for (const ref of refs) {
            await recomputeTradeLinkedAmounts(ref);
          }
        }
        return policy;
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

  /** Debits past their due date — the overdue alert card on every dashboard. */
  overdueLedgerAlerts: protectedProcedure.query(() => getOverdueLedgerAlerts()),

  /**
   * Rejections page data — traders see rejections on their own trades,
   * every other role sees everything.
   */
  rejections: protectedProcedure.input(z.object({ fullHistory: z.boolean().optional() }).optional()).query(({ ctx, input }) => {
    const user = ctx.session.user;
    const fullHistory = input?.fullHistory === true && ["TRADER", "EXECUTION", "CEO"].includes(user.role);
    if (user.role === "TRADER") {
      return listRejections({
        traderName: canonicalTraderName(traderDisplayName({ user } as never)),
        fullHistory,
      });
    }
    return listRejections({ fullHistory });
  }),
});

import { z } from "zod";
import type { Prisma, Reconciliation } from "@prisma/client";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { TradeStatus, ReconStatus } from "@prisma/client";
import { startOfYear } from "date-fns";
import { isMockMode } from "@/server/mock-mode";
import { mockKpis, mockOpenBreaks, mockTradeBlotter } from "@/server/dummy-data";

type TradeBlotterRow = Prisma.TradeGetPayload<{
  include: { commodity: true; counterparty: true };
}>;

export const reportsRouter = router({
  kpis: protectedProcedure.query(async ({ ctx }) => {
    if (isMockMode()) return mockKpis();
    const y0 = startOfYear(new Date());
    const tradesYtd = await ctx.prisma.trade.count({
      where: { tradeDate: { gte: y0 } },
    });
    const invVal = await ctx.prisma.inventory.aggregate({ _sum: { totalValue: true } });
    const mtm = await ctx.prisma.mTMValue.aggregate({ _sum: { mtmPnl: true } });
    const openTrades = await ctx.prisma.trade.count({
      where: {
        tradeStatus: { in: [TradeStatus.CONFIRMED, TradeStatus.EXECUTED, TradeStatus.PENDING] },
      },
    });
    return {
      tradesYtd,
      openTrades,
      inventoryValue: Number(invVal._sum.totalValue ?? 0),
      openMtmPnl: Number(mtm._sum.mtmPnl ?? 0),
    };
  }),

  tradeBlotter: protectedProcedure.query(({ ctx }) => {
    if (isMockMode()) return mockTradeBlotter() as unknown as TradeBlotterRow[];
    return ctx.prisma.trade.findMany({
      include: { commodity: true, counterparty: true },
      orderBy: { tradeDate: "desc" },
      take: 300,
    });
  }),

  /** Stub for scheduled email delivery — implement with your job runner + mail provider. */
  scheduleReport: protectedProcedure
    .input(
      z.object({
        reportId: z.string(),
        cadence: z.enum(["DAILY", "WEEKLY"]),
      }),
    )
    .mutation(() => ({ ok: true, queued: false, message: "Email scheduling not configured" })),

  openBreaks: protectedProcedure.query(({ ctx }) => {
    if (isMockMode()) return mockOpenBreaks() as unknown as Reconciliation[];
    return ctx.prisma.reconciliation.findMany({
      where: { status: ReconStatus.BREAK },
      take: 100,
      orderBy: { reconDate: "desc" },
    });
  }),
});

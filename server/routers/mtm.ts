import { z } from "zod";
import { protectedProcedure, router, roleProcedure } from "@/server/trpc/trpc";
import { Role, TradeStatus } from "@prisma/client";
import { startOfDay, subDays } from "date-fns";
import { calculateMTM } from "@/lib/calculations/mtm";

import type { Context } from "@/server/trpc/context";
import { isMockMode } from "@/server/mock-mode";
import { mockMtmBook, mockMtmHistory } from "@/server/dummy-data";

async function priceOn(db: Context["prisma"], commodityId: string, asOf: Date) {
  const row = await db.marketPrice.findFirst({
    where: { commodityId, priceDate: { lte: asOf } },
    orderBy: { priceDate: "desc" },
  });
  return row ? Number(row.closePrice) : 0;
}

export const mtmRouter = router({
  getBook: protectedProcedure
    .input(
      z.object({
        date: z.coerce.date().optional(),
        commodityId: z.string().optional(),
        sign: z.enum(["pos", "neg", "all"]).default("all"),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (isMockMode()) {
        return mockMtmBook({
          commodityId: input.commodityId,
          sign: input.sign,
        });
      }
      const asOf = startOfDay(input.date ?? new Date());
      const open = [TradeStatus.CONFIRMED, TradeStatus.EXECUTED, TradeStatus.PENDING];
      const trades = await ctx.prisma.trade.findMany({
        where: {
          tradeStatus: { in: open },
          ...(input.commodityId ? { commodityId: input.commodityId } : {}),
        },
        include: { commodity: true, counterparty: true },
        orderBy: { tradeRef: "asc" },
        take: 500,
      });
      const rows = [];
      for (const t of trades) {
        const mp = await priceOn(ctx.prisma, t.commodityId, asOf);
        const { mtmPnl, unrealizedPnl } = calculateMTM(
          Number(t.quantity),
          Number(t.price),
          mp,
          t.direction,
        );
        if (input.sign === "pos" && mtmPnl < 0) continue;
        if (input.sign === "neg" && mtmPnl > 0) continue;
        rows.push({
          tradeRef: t.tradeRef,
          commodity: t.commodity.code,
          qty: Number(t.quantity),
          direction: t.direction,
          bookPrice: Number(t.price),
          marketPrice: mp,
          mtmPnl,
          unrealizedPnl,
          valueDate: asOf.toISOString(),
          currency: t.currency,
          counterparty: t.counterparty.name,
        });
      }
      const totalUnreal = rows.reduce((a, r) => a + r.unrealizedPnl, 0);
      return { rows, totalUnrealizedPnl: totalUnreal, openCount: rows.length };
    }),

  snapPrices: roleProcedure([Role.ADMIN, Role.RISK_MANAGER]).mutation(async () => {
    return { ok: true, message: "EOD snap stub — persist flag in Phase 1.5" };
  }),

  historyTotals: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      if (isMockMode()) return mockMtmHistory(input.days);
      const end = startOfDay(new Date());
      const open = [TradeStatus.CONFIRMED, TradeStatus.EXECUTED, TradeStatus.PENDING];
      const trades = await ctx.prisma.trade.findMany({
        where: { tradeStatus: { in: open } },
        take: 600,
      });
      const points: { date: string; total: number }[] = [];
      for (let i = input.days - 1; i >= 0; i--) {
        const d = subDays(end, i);
        const priceRows = await ctx.prisma.marketPrice.findMany({
          where: { priceDate: d },
        });
        const priceMap = new Map(priceRows.map((p) => [p.commodityId, Number(p.closePrice)]));
        let total = 0;
        for (const t of trades) {
          const mp = priceMap.get(t.commodityId) ?? 0;
          const { mtmPnl } = calculateMTM(Number(t.quantity), Number(t.price), mp, t.direction);
          total += mtmPnl;
        }
        points.push({ date: d.toISOString(), total });
      }
      return points;
    }),
});

import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import type { Context } from "@/server/trpc/context";
import { startOfDay, subDays } from "date-fns";
import { calculateMTM } from "@/lib/calculations/mtm";
import { TradeStatus } from "@prisma/client";
import { isMockMode } from "@/server/mock-mode";
import {
  mockExposureSummary,
  mockPositionBook,
  mockPositionsSummaryCards,
  mockTradesForCommodity,
} from "@/server/dummy-data";

const dateIn = z.object({ date: z.coerce.date().optional() }).optional();

async function latestCloseForCommodity(db: Context["prisma"], commodityId: string, asOf: Date) {
  const row = await db.marketPrice.findFirst({
    where: { commodityId, priceDate: { lte: asOf } },
    orderBy: { priceDate: "desc" },
  });
  return row ? Number(row.closePrice) : 0;
}

export const positionsRouter = router({
  getSummaryCards: protectedProcedure.input(dateIn).query(async ({ ctx, input }) => {
    if (isMockMode()) return mockPositionsSummaryCards();
    const asOf = startOfDay(input?.date ?? new Date());
    const prev = subDays(asOf, 1);
    const positions = await ctx.prisma.position.findMany({
      where: { positionDate: asOf },
      include: { commodity: true },
    });
    const cards = await Promise.all(
      positions.map(async (p) => {
        const m = await latestCloseForCommodity(ctx.prisma, p.commodityId, asOf);
        const mPrev = await latestCloseForCommodity(ctx.prisma, p.commodityId, prev);
        const dayChg = mPrev > 0 ? (m - mPrev) / mPrev : 0;
        return {
          commodityId: p.commodityId,
          code: p.commodity.code,
          name: p.commodity.name,
          longQty: Number(p.longQty),
          shortQty: Number(p.shortQty),
          netQty: Number(p.netQty),
          avgBuyPrice: p.avgBuyPrice ? Number(p.avgBuyPrice) : null,
          avgSellPrice: p.avgSellPrice ? Number(p.avgSellPrice) : null,
          marketPrice: m,
          dayChangePct: dayChg,
        };
      }),
    );
    return cards;
  }),

  getExposureSummary: protectedProcedure.input(dateIn).query(async ({ ctx, input }) => {
    if (isMockMode()) return mockExposureSummary();
    const asOf = startOfDay(input?.date ?? new Date());
    const legs = await ctx.prisma.positionLeg.findMany({
      where: { position: { positionDate: asOf } },
      include: {
        trade: true,
        position: { include: { commodity: true } },
      },
    });
    let totalLong = 0;
    let totalShort = 0;
    let netMTM = 0;
    for (const leg of legs) {
      const mp = await latestCloseForCommodity(ctx.prisma, leg.trade.commodityId, asOf);
      const { mtmPnl } = calculateMTM(
        Number(leg.quantity),
        Number(leg.trade.price),
        mp,
        leg.direction,
      );
      netMTM += mtmPnl;
      if (leg.direction === "BUY") totalLong += Number(leg.quantity);
      else totalShort += Number(leg.quantity);
    }
    return {
      totalLong,
      totalShort,
      netExposure: totalLong - totalShort,
      netMTM,
      asOf: asOf.toISOString(),
    };
  }),

  getBook: protectedProcedure
    .input(
      z
        .object({
          date: z.coerce.date().optional(),
          commodityId: z.string().optional(),
          limit: z.number().min(1).max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (isMockMode()) {
        return mockPositionBook(input?.commodityId).slice(0, input?.limit ?? 100);
      }
      const asOf = startOfDay(input?.date ?? new Date());
      const legs = await ctx.prisma.positionLeg.findMany({
        where: {
          position: {
            positionDate: asOf,
            ...(input?.commodityId ? { commodityId: input.commodityId } : {}),
          },
        },
        take: input?.limit ?? 100,
        orderBy: { trade: { tradeRef: "asc" } },
        include: {
          trade: { include: { commodity: true, counterparty: true } },
          position: true,
        },
      });
      const rows = await Promise.all(
        legs.map(async (leg) => {
          const mp = await latestCloseForCommodity(ctx.prisma, leg.trade.commodityId, asOf);
          const { mtmPnl, unrealizedPnl, bookValue, marketValue } = calculateMTM(
            Number(leg.quantity),
            Number(leg.trade.price),
            mp,
            leg.direction,
          );
          const prev = subDays(asOf, 1);
          const mpPrev = await latestCloseForCommodity(ctx.prisma, leg.trade.commodityId, prev);
          const pct = mpPrev > 0 ? (mp - mpPrev) / mpPrev : 0;
          return {
            id: leg.id,
            commodity: leg.trade.commodity.code,
            commodityName: leg.trade.commodity.name,
            direction: leg.direction,
            quantity: Number(leg.quantity),
            bookPrice: Number(leg.trade.price),
            marketPrice: mp,
            mtmPnl,
            unrealizedPnl,
            pctChange: pct,
            bookValue,
            marketValue,
            currency: leg.trade.currency,
            tradeRef: leg.trade.tradeRef,
            counterparty: leg.trade.counterparty.name,
            updatedAt: leg.updatedAt.toISOString(),
          };
        }),
      );
      return rows;
    }),

  getTradesForCommodity: protectedProcedure
    .input(z.object({ commodityId: z.string(), date: z.coerce.date().optional() }))
    .query(async ({ ctx, input }) => {
      if (isMockMode()) {
        return mockTradesForCommodity().filter((t) => t.commodityId === input.commodityId);
      }
      const asOf = startOfDay(input.date ?? new Date());
      return ctx.prisma.trade.findMany({
        where: {
          commodityId: input.commodityId,
          tradeStatus: { in: [TradeStatus.CONFIRMED, TradeStatus.EXECUTED, TradeStatus.PENDING] },
          positionLegs: { some: { position: { positionDate: asOf } } },
        },
        include: { counterparty: true },
        orderBy: { tradeDate: "desc" },
        take: 200,
      });
    }),
});

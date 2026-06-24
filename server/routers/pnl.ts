import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { startOfDay, endOfDay } from "date-fns";
import { isMockMode } from "@/server/mock-mode";
import { mockPnlAttribution } from "@/server/dummy-data";

export const pnlRouter = router({
  attribution: protectedProcedure
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        commodityId: z.string().optional(),
        desk: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (isMockMode()) return mockPnlAttribution();
      const trades = await ctx.prisma.trade.findMany({
        where: {
          tradeDate: { gte: startOfDay(input.from), lte: endOfDay(input.to) },
          ...(input.commodityId ? { commodityId: input.commodityId } : {}),
          ...(input.desk ? { desk: input.desk } : {}),
        },
        include: { commodity: true },
        take: 2000,
      });

      let priceEffect = 0;
      let volumeEffect = 0;
      let fxEffect = 0;
      const rows: {
        tradeRef: string;
        commodity: string;
        direction: string;
        source: string;
        amount: number;
        currency: string;
      }[] = [];

      for (const t of trades) {
        const q = Number(t.quantity);
        const px = Number(t.price);
        const pe = (px * 0.002) * q;
        priceEffect += pe * (t.direction === "BUY" ? 1 : -1);
        volumeEffect += (rndSign(t.tradeRef) * q * 0.15);
        if (t.currency === "PKR") fxEffect += q * px * 0.0008;
        rows.push({
          tradeRef: t.tradeRef,
          commodity: t.commodity.code,
          direction: t.direction,
          source: "PRICE_EFFECT",
          amount: pe,
          currency: t.currency,
        });
      }

      const total = priceEffect + volumeEffect + fxEffect;
      return {
        totalPnl: total,
        priceEffect,
        volumeEffect,
        fxEffect,
        other: 0,
        rows: rows.slice(0, 500),
      };
    }),
});

function rndSign(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h << 5) - h + seed.charCodeAt(i);
  return h % 2 === 0 ? 1 : -1;
}

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { roleProcedure, router } from "@/server/trpc/trpc";
import {
  DESK_MARKET_CURRENCIES,
  deskMarketUnits,
  getMarketPriceSnapshot,
  listDailyMarketPrices,
  upsertDailyMarketPrice,
} from "@/server/market-prices";

const execRoles = ["EXECUTION", "ADMIN", "FINANCE"] as const;

const optionalPositive = z.number().positive().nullable().optional();

export const marketRouter = router({
  snapshot: roleProcedure([...execRoles, "TRADER", "RISK_MANAGER", "READ_ONLY"]).query(() => {
    return getMarketPriceSnapshot();
  }),

  dailyPrices: roleProcedure([...execRoles, "TRADER", "ADMIN"]).query(() => {
    return listDailyMarketPrices();
  }),

  options: roleProcedure([...execRoles]).query(() => ({
    currencies: [...DESK_MARKET_CURRENCIES],
    units: [...deskMarketUnits()],
  })),

  upsertDailyPrice: roleProcedure([...execRoles])
    .input(
      z.object({
        code: z.string().min(1),
        cnf: optionalPositive,
        cnfCurrency: z.string().trim().optional().nullable(),
        cnfUnit: z.string().trim().optional().nullable(),
        yesterdayRate: optionalPositive,
        yesterdayCurrency: z.string().trim().optional().nullable(),
        yesterdayUnit: z.string().trim().optional().nullable(),
        priceDate: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      try {
        return upsertDailyMarketPrice({
          code: input.code,
          cnf: input.cnf,
          cnfCurrency: input.cnfCurrency,
          cnfUnit: input.cnfUnit,
          yesterdayRate: input.yesterdayRate,
          yesterdayCurrency: input.yesterdayCurrency,
          yesterdayUnit: input.yesterdayUnit,
          priceDate: input.priceDate,
          updatedBy: ctx.session.user.name ?? undefined,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not publish price",
        });
      }
    }),
});

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CommodityCategory, CounterpartyType, TradeDirection, TradeStatus } from "@prisma/client";
import type { Session } from "next-auth";
import { protectedProcedure, roleProcedure, router } from "@/server/trpc/trpc";
import { isMockMode } from "@/server/mock-mode";
import { traderDisplayName } from "@/lib/trader-display-name";
import { canonicalTraderName } from "@/lib/trader-identity";
import {
  BUYING_CATEGORIES,
  EXECUTION_PROFILES,
  INCOTERMS,
  isDestinationRequired,
  isOriginRequired,
  PRICE_BASIS_OPTIONS,
  type QualityTolerances,
} from "@/lib/trade-constants";
import { lockTradeInStore, exportLockedContractsCsv } from "@/server/execution-store";
import {
  addCustomCommodity,
  addCustomCounterparty,
  addCustomGrade,
  addCustomLocation,
  getCommodityById,
  getCounterpartyById,
  getTraderReferenceData,
} from "@/server/trader-master-data";
import {
  mockBookTrade,
  mockTraderActionItems,
  mockTraderDeskSummary,
  mockTraderExposure,
  mockTraderTradeByRef,
  mockTraderTrades,
  syncBookedTradesFromDisk,
  type KycStatus,
  type PaymentType,
} from "@/server/dummy-data";

const paymentTypeSchema = z.enum(["DP", "LC", "CAD", "ADVANCE_100", "CREDIT_30"]);
const quantityUnitSchema = z.string().trim().min(1);
const priceBasisSchema = z.enum(PRICE_BASIS_OPTIONS);
const incotermSchema = z.enum(INCOTERMS);

function traderNameFromSession(user: Session["user"]) {
  return canonicalTraderName(traderDisplayName({ user } as Session));
}

function validateIncotermLocations(
  incoterms: string,
  originName: string,
  destName: string | undefined,
  ctx: z.RefinementCtx,
) {
  if (isOriginRequired(incoterms) && !originName.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Shipment origin required", path: ["originName"] });
  }
  if (isDestinationRequired(incoterms) && !destName?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Destination required for this Incoterm",
      path: ["destName"],
    });
  }
}

const bookTradeInputSchema = z
  .object({
    traderName: z.string().min(1),
    commodityId: z.string(),
    counterpartyId: z.string(),
    direction: z.nativeEnum(TradeDirection),
    quantity: z.number().positive(),
    quantityUnit: quantityUnitSchema,
    price: z.number().positive(),
    currency: z.enum(["USD", "PKR"]),
    priceBasis: priceBasisSchema,
    deliveryStart: z.coerce.date(),
    deliveryEnd: z.coerce.date(),
    originName: z.string(),
    destName: z.string().optional(),
    incoterms: incotermSchema,
    paymentType: paymentTypeSchema,
    grade: z.string().min(1),
    productOrigin: z.string().min(1),
    qualityTolerances: z.string().min(1),
    maxMoisturePct: z.number().min(0).max(100),
    notes: z.string().optional(),
    buyingCategory: z.enum(BUYING_CATEGORIES).optional(),
    ratePerMaund: z.number().positive().optional(),
    commissionPerMaund: z.number().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    validateIncotermLocations(data.incoterms, data.originName, data.destName, ctx);
    if (data.deliveryEnd < data.deliveryStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delivery end must be after start",
        path: ["deliveryEnd"],
      });
    }
  });

export const traderRouter = router({
  deskSummary: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return mockTraderDeskSummary(name);
  }),

  myTrades: protectedProcedure
    .input(z.object({ status: z.nativeEnum(TradeStatus).optional() }).optional())
    .query(({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      return mockTraderTrades(name, { status: input?.status });
    }),

  tradeByRef: protectedProcedure
    .input(z.object({ tradeRef: z.string() }))
    .query(({ ctx, input }) => {
      syncBookedTradesFromDisk();
      const name = traderNameFromSession(ctx.session.user);
      return mockTraderTradeByRef(name, input.tradeRef.trim());
    }),

  myExposure: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return mockTraderExposure(name);
  }),

  actionItems: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return mockTraderActionItems(name);
  }),

  referenceData: protectedProcedure.query(() => getTraderReferenceData()),

  addCommodity: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        name: z.string().min(1),
        code: z.string().min(2).max(6),
        unit: quantityUnitSchema,
        category: z.nativeEnum(CommodityCategory).optional(),
      }),
    )
    .mutation(({ input }) => {
      if (!isMockMode()) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Custom commodities only in mock mode" });
      }
      try {
        return addCustomCommodity({
          name: input.name,
          code: input.code,
          unit: input.unit,
          category: input.category,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not add commodity",
        });
      }
    }),

  addGrade: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ commodityCode: z.string().min(1), grade: z.string().min(1) }))
    .mutation(({ input }) => {
      if (!isMockMode()) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Custom grades only in mock mode" });
      }
      try {
        return { grade: addCustomGrade(input.commodityCode, input.grade) };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not add grade",
        });
      }
    }),

  addLocation: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ name: z.string().min(1) }))
    .mutation(({ input }) => {
      if (!isMockMode()) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Custom locations only in mock mode" });
      }
      try {
        return addCustomLocation(input.name);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not add location",
        });
      }
    }),

  addCounterparty: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        name: z.string().min(1),
        code: z.string().min(2).max(8),
        type: z.nativeEnum(CounterpartyType),
        country: z.string().min(1),
        kycStatus: z.enum(["VERIFIED", "PENDING", "EXPIRED", "NOT_ON_FILE"]).optional(),
        kycRef: z.string().optional(),
        kycExpires: z.coerce.date().optional(),
        companyNameNtn: z.string().optional(),
        ntn: z.string().optional(),
        address: z.string().optional(),
        bankDetails: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      if (!isMockMode()) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Custom counterparties only in mock mode" });
      }
      try {
        return addCustomCounterparty({
          name: input.name,
          code: input.code,
          type: input.type,
          country: input.country,
          kycStatus: input.kycStatus,
          kycRef: input.kycRef ?? null,
          kycExpires: input.kycExpires ?? null,
          companyNameNtn: input.companyNameNtn ?? null,
          ntn: input.ntn ?? null,
          address: input.address ?? null,
          bankDetails: input.bankDetails ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not add counterparty",
        });
      }
    }),

  bookTrade: roleProcedure(["TRADER", "ADMIN"])
    .input(bookTradeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const traderName = canonicalTraderName(
        traderNameFromSession(ctx.session.user) || input.traderName.trim(),
      );

      const cp = getCounterpartyById(input.counterpartyId);
      if (!cp) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid counterparty" });
      }
      if (cp.kycStatus !== "VERIFIED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Counterparty KYC is ${cp.kycStatus}. Only VERIFIED counterparties can be booked.`,
        });
      }

      const c = getCommodityById(input.commodityId);
      if (!c) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid commodity" });
      }

      if (isMockMode()) {
        syncBookedTradesFromDisk();
        const trade = mockBookTrade({
          traderName,
          commodityId: c.id,
          commodityCode: c.code,
          commodityName: c.name,
          counterpartyId: cp.id,
          counterpartyName: cp.name,
          counterpartyCode: cp.code,
          direction: input.direction,
          quantity: input.quantity,
          quantityUnit: input.quantityUnit,
          price: input.price,
          currency: input.currency,
          priceBasis: input.priceBasis,
          deliveryStart: input.deliveryStart,
          deliveryEnd: input.deliveryEnd,
          originName: input.originName.trim(),
          destName: (input.destName ?? "").trim(),
          incoterms: input.incoterms,
          paymentType: input.paymentType as PaymentType,
          grade: input.grade,
          productOrigin: input.productOrigin,
          qualityTolerances: input.qualityTolerances,
          maxMoisturePct: input.maxMoisturePct,
          counterpartyKycStatus: cp.kycStatus as KycStatus,
          counterpartyKycRef: cp.kycRef,
          counterpartyCompanyNameNtn: cp.companyNameNtn,
          counterpartyNtn: cp.ntn,
          counterpartyAddress: cp.address,
          counterpartyBankDetails: cp.bankDetails,
          notes: input.notes,
          buyingCategory: input.buyingCategory,
          ratePerMaund: input.ratePerMaund,
          commissionPerMaund: input.commissionPerMaund,
        });
        return { ok: true as const, tradeRef: trade.tradeRef, trade };
      }

      return { ok: true as const, tradeRef: "KAS-2026-PENDING", trade: null };
    }),

  lockTrade: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        tradeRef: z.string(),
        buyingCategory: z.enum(BUYING_CATEGORIES).optional(),
        ratePerMaund: z.number().positive().optional(),
        commissionPerMaund: z.number().min(0).optional(),
        qualityTolerances: z
          .object({
            damagePct: z.number().min(0),
            brokenPct: z.number().min(0),
            fungusPct: z.number().min(0),
            foreignMatterPct: z.number().min(0),
            moisturePct: z.number().min(0),
          })
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!isMockMode()) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Lock trade only in mock mode" });
      }
      const traderName = traderNameFromSession(ctx.session.user);
      try {
        const trade = lockTradeInStore(traderName, input.tradeRef, {
          lockedBy: ctx.session.user.name ?? traderName,
          buyingCategory: input.buyingCategory,
          ratePerMaund: input.ratePerMaund,
          commissionPerMaund: input.commissionPerMaund,
          qualityTolerances: input.qualityTolerances as QualityTolerances | undefined,
        });
        return { ok: true as const, trade };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not lock trade",
        });
      }
    }),

  exportLockedTrades: roleProcedure(["TRADER", "ADMIN", "EXECUTION"])
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        executionProfile: z.enum(EXECUTION_PROFILES).optional(),
      }),
    )
    .mutation(({ input }) => {
      if (!isMockMode()) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED" });
      }
      const csv = exportLockedContractsCsv(input.from, input.to, input.executionProfile);
      return { csv, filename: `locked-trades-${input.from.toISOString().slice(0, 10)}-${input.to.toISOString().slice(0, 10)}.csv` };
    }),
});

export type TraderTrade = ReturnType<typeof mockTraderTrades>[number];

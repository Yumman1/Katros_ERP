import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CommodityCategory, CounterpartyType, TradeDirection, TradeStatus } from "@prisma/client";
import type { Session } from "next-auth";
import { headProcedure, protectedProcedure, roleProcedure, router } from "@/server/trpc/trpc";
import { traderDisplayName } from "@/lib/trader-display-name";
import { canonicalTraderName } from "@/lib/trader-identity";
import {
  buyingCategoryFromIncoterms,
  EXECUTION_PROFILES,
  INCOTERMS,
  ALL_PRICE_BASIS_OPTIONS,
  TRADE_SCOPES,
  type QualityTolerances,
  formatQualityTolerancesSummary,
  priceBasisRequiresQuote,
} from "@/lib/trade-constants";
import { computeWarehouseAvailability } from "@/lib/warehouse-availability";
import { autoCloseThresholdQty } from "@/lib/contract-closure";
import {
  getInboundReceipts,
  getOutboundDispatches,
  getLockedContracts,
  lockTradeInStore,
  exportLockedContractsCsv,
} from "@/server/execution-store";
import { exportTradeFileCsv } from "@/server/trade-file-export";
import { computePositionLedger } from "@/server/position-ledger";
import {
  addCustomCommodity,
  addCustomCounterparty,
  addCustomGrade,
  addCustomLocation,
  getCommodityById,
  getCommodityPriceBasis,
  getCounterpartyById,
  getCompanyWarehouses,
  getTraderReferenceData,
  registerCustomUnit,
} from "@/server/trader-master-data";
import { canonicalKgPerUnitOf, PRICE_CURRENCIES } from "@/lib/price-units";
import { commodityCreateInputSchema } from "@/lib/commodity-registration";
import { qualitySummaryFromParams, resolveAllTradeParameters } from "@/lib/trade-parameters";
import { toMt } from "@/lib/unit-registry";
import {
  mockBookTrade,
  mockTraderActionItems,
  mockTraderDeskSummary,
  mockTraderExposure,
  mockTraderTradeByRef,
  mockTraderTrades,
  type KycStatus,
  type PaymentType,
} from "@/server/dummy-data";
import { lockOpenTradeAfterTraderReview, completeTraderTradePrice, submitTradeToExecution, updateTraderDraftTrade } from "@/server/open-trades";
import { getTradeTimeline } from "@/server/trade-activity";

const paymentTypeSchema = z.enum([
  "DP",
  "LC",
  "CAD",
  "ADVANCE_100",
  "CREDIT",
  "CREDIT_30",
  "AFTER_DELIVERY_100",
]);
const quantityUnitSchema = z.string().trim().min(1);
const priceBasisSchema = z.enum(ALL_PRICE_BASIS_OPTIONS);
const incotermSchema = z.enum(INCOTERMS);
const priceCurrencySchema = z.enum(PRICE_CURRENCIES);
const priceBasisConfigSchema = z.object({
  currency: priceCurrencySchema,
  weightUnit: z.string().trim().min(1),
  kgPerUnit: z.number().positive(),
});

function traderNameFromSession(user: Session["user"]) {
  return canonicalTraderName(traderDisplayName({ user } as Session));
}

function validateIncotermLocations(
  _incoterms: string,
  _originName: string,
  _ctx: z.RefinementCtx,
) {
  // Origin / load point is optional on every trade.
}

const tradeParamValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null()]),
);

const tradeParamDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "number", "percent", "select", "date", "textarea"]),
  group: z.enum(["contract", "quality", "logistics", "commercial"]),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  unit: z.string().optional(),
  required: z.boolean().optional(),
});

const bookTradeInputSchema = z
  .object({
    traderName: z.string().min(1),
    commodityId: z.string(),
    counterpartyId: z.string(),
    direction: z.nativeEnum(TradeDirection),
    quantity: z.number().positive(),
    quantityUnit: quantityUnitSchema,
    /** Original entered qty/unit before MT conversion (optional — defaults to quantity fields). */
    quantityEntered: z.number().positive().optional(),
    quantityEnteredUnit: quantityUnitSchema.optional(),
    price: z.number().positive().optional(),
    currency: z.enum(["USD", "PKR"]).optional(),
    /** Quoted price metric. Currency of `price`; settlement currency is derived. */
    priceCurrency: priceCurrencySchema.optional(),
    priceWeightUnit: z.string().trim().min(1).optional(),
    priceKgPerUnit: z.number().positive().optional(),
    /** Broker commission in the same price metric as `price`. */
    commissionPerUnit: z.number().min(0).optional(),
    /** Flat broker commission in the quoted price currency (PKR, USD, or US cents). */
    commissionAmount: z.number().min(0).optional(),
    priceBasis: priceBasisSchema,
    tradeDate: z.coerce.date(),
    deliveryStart: z.coerce.date(),
    deliveryEnd: z.coerce.date(),
    originName: z.string(),
    destName: z.string().optional(),
    incoterms: incotermSchema,
    paymentType: paymentTypeSchema,
    creditDays: z.number().int().positive().optional(),
    grade: z.string().optional(),
    productOrigin: z.string().optional(),
    qualityTolerances: z.string().optional(),
    qualityTolerancesDetail: z
      .object({
        damagePct: z.number().min(0).max(100),
        brokenPct: z.number().min(0).max(100),
        fungusPct: z.number().min(0).max(100),
        foreignMatterPct: z.number().min(0).max(100),
        moisturePct: z.number().min(0).max(100),
      })
      .optional(),
    maxMoisturePct: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .nullable(),
    tradeParams: tradeParamValuesSchema.optional(),
    notes: z.string().optional(),
    tradeScope: z.enum(TRADE_SCOPES),
    ratePerMaund: z.number().positive().optional(),
    commissionPerMaund: z.number().min(0).optional(),
    /** When true, submit to execution Open Trades instead of a trader-only draft. */
    submitToExecution: z.boolean().optional(),
    /** @deprecated Use submitToExecution — direct lock on book is no longer supported. */
    lockNow: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    validateIncotermLocations(data.incoterms, data.originName, ctx);
    if (data.deliveryEnd < data.deliveryStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delivery end must be after start",
        path: ["deliveryEnd"],
      });
    }
    if (priceBasisRequiresQuote(data.priceBasis)) {
      if (data.price == null || data.price <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Price is required for fixed trades",
          path: ["price"],
        });
      }
      if (data.commissionPerUnit == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Broker commission is required for fixed trades",
          path: ["commissionPerUnit"],
        });
      }
    }
  });

export const traderRouter = router({
  deskSummary: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return mockTraderDeskSummary(name);
  }),

  myTrades: protectedProcedure
    .input(
      z
        .object({
          status: z.nativeEnum(TradeStatus).optional(),
          bucket: z.enum(["DRAFTS", "LOCKED", "CLOSED"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      const all = await mockTraderTrades(name);

      // A locked trade whose execution contract is fully fulfilled counts as Closed.
      const closedRefs = new Set(
        (await getLockedContracts({ openOnly: false }))
          .filter((c) => c.contractStatus !== "Open")
          .map((c) => c.tradeRef),
      );

      const overlaid = all.map((t) =>
        (t.tradeStatus === TradeStatus.LOCKED || t.tradeStatus === TradeStatus.CONFIRMED) &&
        closedRefs.has(t.tradeRef)
          ? { ...t, tradeStatus: TradeStatus.EXECUTED }
          : t,
      );

      const isDraft = (s: TradeStatus) => s === TradeStatus.PENDING;
      const isLocked = (s: TradeStatus) =>
        s === TradeStatus.LOCKED || s === TradeStatus.CONFIRMED;
      const isClosed = (s: TradeStatus) =>
        s === TradeStatus.EXECUTED || s === TradeStatus.SETTLED;

      const bucket = input?.bucket;
      if (bucket === "DRAFTS") return overlaid.filter((t) => isDraft(t.tradeStatus));
      if (bucket === "LOCKED") return overlaid.filter((t) => isLocked(t.tradeStatus));
      if (bucket === "CLOSED") return overlaid.filter((t) => isClosed(t.tradeStatus));
      if (input?.status) return overlaid.filter((t) => t.tradeStatus === input.status);
      return overlaid;
    }),

  tradeByRef: protectedProcedure
    .input(z.object({ tradeRef: z.string() }))
    .query(({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      return mockTraderTradeByRef(name, input.tradeRef.trim());
    }),

  tradeTimeline: protectedProcedure
    .input(z.object({ tradeRef: z.string() }))
    .query(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      const trade = await mockTraderTradeByRef(name, input.tradeRef.trim());
      if (!trade) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
      }
      return getTradeTimeline(input.tradeRef.trim());
    }),

  updateDraftTrade: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        tradeRef: z.string(),
        patch: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const traderName = traderNameFromSession(ctx.session.user);
        const editedBy = ctx.session.user.name ?? ctx.session.user.email ?? traderName;
        const trade = await updateTraderDraftTrade(
          traderName,
          input.tradeRef.trim(),
          input.patch,
          editedBy,
        );
        return { ok: true as const, trade };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update draft trade",
        });
      }
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

  warehouseAvailability: protectedProcedure
    .input(z.object({ commodityId: z.string().optional() }).optional())
    .query(async ({ input }) => {
    const locations = await getCompanyWarehouses();
    const contracts = (await getLockedContracts({ openOnly: false })).map((c) => ({
      tradeRef: c.tradeRef,
      commodityCode: c.commodityCode,
      quantityUnit: c.quantityUnit,
    }));
    const commodity = input?.commodityId ? await getCommodityById(input.commodityId) : null;
    return computeWarehouseAvailability(
      locations,
      await getInboundReceipts(),
      await getOutboundDispatches(),
      contracts,
      null,
      commodity
        ? { code: commodity.code, category: commodity.category, unit: commodity.unit }
        : null,
    );
  }),

  addCommodity: roleProcedure(["CEO", "ADMIN"])
    .input(commodityCreateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await addCustomCommodity(input);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not add commodity",
        });
      }
    }),

  addGrade: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ commodityCode: z.string().min(1), grade: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return { grade: await addCustomGrade(input.commodityCode, input.grade) };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not add grade",
        });
      }
    }),

  addLocation: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await addCustomLocation({ name: input.name });
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
        type: z.nativeEnum(CounterpartyType).optional(),
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
    .mutation(async ({ input }) => {
      try {
        return await addCustomCounterparty({
          name: input.name,
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

  addUnit: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        code: z.string().trim().min(1),
        kgPerUnit: z.number().positive(),
        label: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await registerCustomUnit(input);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not register unit",
        });
      }
    }),

  bookTrade: roleProcedure(["TRADER", "ADMIN"])
    .input(bookTradeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const traderName = canonicalTraderName(
        traderNameFromSession(ctx.session.user) || input.traderName.trim(),
      );

      const cp = await getCounterpartyById(input.counterpartyId);
      if (!cp) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid counterparty" });
      }

      const c = await getCommodityById(input.commodityId);
      if (!c) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid commodity" });
      }

      {
        // Resolve the quoted price metric: use what the form sent, else the commodity's
        // configured per-scope basis. The price is then mapped to the canonical qty unit.
        const configuredBasis = await getCommodityPriceBasis(c.id, input.tradeScope);
        const priceCurrency = input.priceCurrency ?? configuredBasis.currency;
        const priceWeightUnit = input.priceWeightUnit ?? configuredBasis.weightUnit;
        const priceKgPerUnit = input.priceKgPerUnit ?? configuredBasis.kgPerUnit;
        const canonicalKgPerUnit = canonicalKgPerUnitOf(c);
        const paramDefs = resolveAllTradeParameters(c.code, c.tradeParameterDefs);
        const tradeParams = input.tradeParams ?? {};
        const qualityTolerances =
          input.qualityTolerances?.trim() ||
          (input.qualityTolerancesDetail
            ? formatQualityTolerancesSummary(input.qualityTolerancesDetail)
            : qualitySummaryFromParams(tradeParams, paramDefs));
        const moistureRaw = tradeParams.moisture;
        const maxMoisturePct =
          input.maxMoisturePct ??
          input.qualityTolerancesDetail?.moisturePct ??
          (typeof moistureRaw === "number"
            ? moistureRaw
            : typeof moistureRaw === "string" && moistureRaw
              ? parseFloat(moistureRaw.replace(/[^\d.]/g, "")) || undefined
              : undefined);

        const qtyEntered = input.quantityEntered ?? input.quantity;
        const qtyEnteredUnit = input.quantityEnteredUnit ?? input.quantityUnit;

        const trade = await mockBookTrade({
          traderName,
          actorId: ctx.session.user.id,
          commodityId: c.id,
          commodityCode: c.code,
          commodityName: c.name,
          counterpartyId: cp.id,
          counterpartyName: cp.name,
          counterpartyCode: cp.code,
          direction: input.direction,
          quantity: toMt(qtyEntered, qtyEnteredUnit),
          quantityUnit: "MT",
          quantityEntered: qtyEntered,
          quantityEnteredUnit: qtyEnteredUnit,
          price: input.price,
          currency: input.currency,
          priceCurrency,
          priceWeightUnit,
          priceKgPerUnit,
          commissionPerUnit: input.commissionPerUnit,
          commissionAmount: input.commissionAmount,
          commissionPerMaund: input.commissionPerMaund,
          canonicalKgPerUnit,
          priceBasis: input.priceBasis,
          tradeDate: input.tradeDate,
          deliveryStart: input.deliveryStart,
          deliveryEnd: input.deliveryEnd,
          originName: input.originName.trim(),
          destName: (input.destName ?? "").trim(),
          incoterms: input.incoterms,
          paymentType: input.paymentType as PaymentType,
          creditDays: input.creditDays,
          grade: input.grade?.trim() || "—",
          productOrigin: input.productOrigin?.trim() || "",
          qualityTolerances,
          qualityTolerancesDetail: input.qualityTolerancesDetail,
          maxMoisturePct: maxMoisturePct ?? undefined,
          tradeParams,
          counterpartyKycStatus: cp.kycStatus as KycStatus,
          counterpartyKycRef: cp.kycRef,
          counterpartyCompanyNameNtn: cp.companyNameNtn,
          counterpartyNtn: cp.ntn,
          counterpartyAddress: cp.address,
          counterpartyBankDetails: cp.bankDetails,
          notes: input.notes,
          buyingCategory: buyingCategoryFromIncoterms(input.incoterms, input.direction) ?? undefined,
          tradeScope: input.tradeScope,
          ratePerMaund: input.ratePerMaund,
          submitToExecution: input.submitToExecution === true || input.lockNow === true,
        });

        return { ok: true as const, tradeRef: trade.tradeRef, trade };
      }
    }),

  lockTrade: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        tradeRef: z.string(),
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
    .mutation(async ({ ctx, input }) => {
      const traderName = traderNameFromSession(ctx.session.user);
      try {
        const existing = await mockTraderTradeByRef(traderName, input.tradeRef);
        if (existing?.submittedToExecution && existing.pendingTraderReview) {
          const trade = await lockOpenTradeAfterTraderReview(traderName, input.tradeRef, {
            lockedBy: ctx.session.user.name ?? traderName,
            ratePerMaund: input.ratePerMaund,
            commissionPerMaund: input.commissionPerMaund,
            qualityTolerances: input.qualityTolerances as QualityTolerances | undefined,
          });
          return { ok: true as const, trade };
        }
        const trade = await lockTradeInStore(traderName, input.tradeRef, {
          lockedBy: ctx.session.user.name ?? traderName,
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

  submitTradeToExecution: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ tradeRef: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const trade = await submitTradeToExecution(input.tradeRef.trim());
        return { ok: true as const, trade };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not submit trade",
        });
      }
    }),

  completeTradePrice: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        tradeRef: z.string(),
        price: z.number().positive(),
        commissionPerUnit: z.number().min(0).optional(),
        priceCurrency: priceCurrencySchema.optional(),
        priceWeightUnit: z.string().trim().min(1).optional(),
        priceKgPerUnit: z.number().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const traderName = traderNameFromSession(ctx.session.user);
      const existing = await mockTraderTradeByRef(traderName, input.tradeRef.trim());
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
      }
      try {
        const trade = await completeTraderTradePrice(traderName, input.tradeRef.trim(), {
          price: input.price,
          commissionPerUnit: input.commissionPerUnit,
          priceCurrency: input.priceCurrency,
          priceWeightUnit: input.priceWeightUnit,
          priceKgPerUnit: input.priceKgPerUnit,
        });
        return { ok: true as const, trade };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not save price",
        });
      }
    }),

  // Trade deletion requires CEO approval via change request — no direct head delete.
  deleteTrade: headProcedure("TRADING")
    .input(z.object({ tradeRef: z.string() }))
    .mutation(() => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Trade deletion requires CEO approval. Use the change form on the trade detail page.",
      });
    }),

  exportLockedTrades: roleProcedure(["TRADER", "ADMIN", "EXECUTION"])
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        executionProfile: z.enum(EXECUTION_PROFILES).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const csv = await exportLockedContractsCsv(input.from, input.to, input.executionProfile);
      return { csv, filename: `locked-trades-${input.from.toISOString().slice(0, 10)}-${input.to.toISOString().slice(0, 10)}.csv` };
    }),

  exportTradeFile: roleProcedure(["TRADER", "ADMIN", "EXECUTION"])
    .input(
      z
        .object({
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          commodityCode: z.string().optional(),
          counterpartyId: z.string().optional(),
          counterpartyName: z.string().optional(),
          direction: z.enum(["BUY", "SELL"]).optional(),
          tradeScope: z.enum(TRADE_SCOPES).optional(),
          tradeStatus: z.string().optional(),
          incoterms: z.string().optional(),
          traderName: z.string().optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const csv = await exportTradeFileCsv(input ?? undefined);
      const stamp = new Date().toISOString().slice(0, 10);
      return { csv, filename: `trade-file-${stamp}.csv` };
    }),

  positionLedger: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return computePositionLedger({ traderName: name });
  }),

  /** Locked trades with fulfillment progress for the signed-in trader. */
  tradeFulfillment: protectedProcedure.query(async ({ ctx }) => {
    const traderName = traderNameFromSession(ctx.session.user);
    return (await getLockedContracts({}))
      .filter((c) => c.traderName === traderName)
      .map((c) => ({
        tradeRef: c.tradeRef,
        direction: c.direction,
        executionProfile: c.executionProfile,
        tradeScope: c.tradeScope,
        incoterms: c.incoterms,
        commodityCode: c.commodityCode,
        commodityName: c.commodityName,
        counterpartyName: c.counterpartyName,
        quantityUnit: c.quantityUnit,
        contractualQtyMt: c.contractualQtyMt,
        receivedQtyMt: c.receivedQtyMt,
        openQtyMt: c.openQtyMt,
        contractStatus: c.contractStatus,
        quantityToleranceMt: c.quantityToleranceMt,
        autoCloseAboveQtyMt: autoCloseThresholdQty(c.contractualQtyMt, c.quantityToleranceMt),
        fulfillmentPct:
          c.contractualQtyMt > 0 ? Math.min(1, c.receivedQtyMt / c.contractualQtyMt) : 0,
        warehouseAllocationProgress: c.warehouseAllocationProgress,
        deliveryStart: c.deliveryStart,
        deliveryEnd: c.deliveryEnd,
        lockedAt: c.lockedAt,
      }));
  }),
});

export type TraderTrade = Awaited<ReturnType<typeof mockTraderTrades>>[number];

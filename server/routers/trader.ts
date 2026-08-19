import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CounterpartyType, TradeDirection, TradeStatus } from "@prisma/client";
import type { Session } from "next-auth";
import { prisma } from "@/server/db";
import { headProcedure, protectedProcedure, roleProcedure, router } from "@/server/trpc/trpc";
import { traderDisplayName } from "@/lib/trader-display-name";
import { canonicalTraderName, traderNamesMatch } from "@/lib/trader-identity";
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
import { normWarehouseName } from "@/lib/warehouse-allocation";
import { buildLocationCommodityInventory } from "@/lib/inventory-stock";
import { autoCloseThresholdQty } from "@/lib/contract-closure";
import {
  getInboundReceipts,
  getOutboundDispatches,
  getPendingTrucks,
  getLockedContracts,
  getTraderInvoiceApprovals,
  getTraderSaleApprovals,
  getTraderUnpaidSellTrucks,
  getTraderInboundOverDeliveries,
  lockTradeInStore,
  exportLockedContractsCsv,
  traderResolveGateInvoice,
  traderResolveSaleTruck,
  traderResolveInboundOverDelivery,
  TraderInvoiceOwnershipError,
} from "@/server/execution-store";
import { exportTradeFileCsv } from "@/server/trade-file-export";
import { loadStockTransfersForStock } from "@/server/execution/stock-transfer-load";
import { computePositionLedger } from "@/server/position-ledger";
import { getSeasonNetPositions, setPositionMarketInput } from "@/server/net-position";
import { getCounterpartyLedgers } from "@/server/finance/ledger";
import { buildTraderCounterpartyReport } from "@/server/trader-reports";
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
  updateCustomCounterparty,
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
  mockTradeByRefGlobal,
  type KycStatus,
  type PaymentType,
} from "@/server/dummy-data";
import { buildSettlementNotePayload, closeTradeWithinTolerance } from "@/server/trade-closure";
import { createChangeRequest, hasOpenChangeRequest } from "@/server/change-requests-store";
import {
  assertPriceReadyForLock,
  assertWarehouseReadyForLock,
  cancelTraderTrade,
  lockOpenTradeAfterTraderReview,
  completeTraderTradePrice,
  submitTradeToExecution,
  traderApproveExecutionEdits,
  updateTraderDraftTrade,
} from "@/server/open-trades";
import { getTradeActivityLog, getTradeTimeline } from "@/server/trade-activity";
import {
  deleteTradeDraft,
  getTradeDraft,
  listTradeDrafts,
  upsertTradeDraft,
} from "@/server/trade-drafts";
import { cancelTradeSettlement, requestTradeSettlement } from "@/server/trade-settlement";
import {
  getTradeSettlement,
  listSettledTrades,
  raiseSettlementInvoice,
  voidSettlementInvoice,
} from "@/server/settlement-billing";
import { getTraderBookTrades } from "@/server/trader-book";

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
const _priceBasisConfigSchema = z.object({
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

const _tradeParamDefSchema = z.object({
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
    /** Crop season the trade books into — one position book per season. */
    season: z.enum(["WINTER", "SUMMER"]).optional(),
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
          bucket: z.enum(["DRAFTS", "LOCKED", "CLOSED", "CANCELLED", "SETTLED"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      const overlaid = await getTraderBookTrades(name);

      const isDraft = (s: TradeStatus) => s === TradeStatus.PENDING;
      const isLocked = (s: TradeStatus) =>
        s === TradeStatus.LOCKED || s === TradeStatus.CONFIRMED;
      const isCancelled = (s: TradeStatus) => s === TradeStatus.CANCELLED;
      // A settled trade is still collecting its money until the ledger is
      // whole, so it belongs in Settled — not Closed — until it closes.
      const isSettling = (t: (typeof overlaid)[number]) =>
        t.directSettled === true && t.settlementClosedAt == null;
      const isClosed = (t: (typeof overlaid)[number]) =>
        t.tradeStatus === TradeStatus.EXECUTED ||
        (t.tradeStatus === TradeStatus.SETTLED && !isSettling(t));

      const bucket = input?.bucket;
      if (bucket === "DRAFTS") return overlaid.filter((t) => isDraft(t.tradeStatus));
      if (bucket === "LOCKED") return overlaid.filter((t) => isLocked(t.tradeStatus));
      if (bucket === "CLOSED") return overlaid.filter(isClosed);
      if (bucket === "SETTLED") return overlaid.filter((t) => t.directSettled === true);
      if (bucket === "CANCELLED") return overlaid.filter((t) => isCancelled(t.tradeStatus));
      if (input?.status) return overlaid.filter((t) => t.tradeStatus === input.status);
      return overlaid;
    }),

  /** Count for the Cancelled tab badge in My Trades. */
  myCancelledCount: protectedProcedure.query(async ({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    const all = await mockTraderTrades(name);
    return all.filter((t) => t.tradeStatus === TradeStatus.CANCELLED).length;
  }),

  /**
   * Cancelled trades seen through the cancellation itself: the debit/credit
   * note it raised, what that note is worth, and when it was cancelled. The
   * booking columns (price, notional, delivery) say nothing once a trade is
   * dead, so the Cancelled tab shows this instead.
   */
  myCancelledTrades: protectedProcedure.query(async ({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    const all = await mockTraderTrades(name);
    const cancelled = all.filter((t) => t.tradeStatus === TradeStatus.CANCELLED);
    if (cancelled.length === 0) return [];

    const refs = cancelled.map((t) => t.tradeRef);
    const [notes, activities] = await Promise.all([
      prisma.counterpartyLedgerEntry.findMany({
        where: { tradeRef: { in: refs }, sourceType: "ADJUSTMENT", sourceRef: { not: null } },
        orderBy: { entryDate: "desc" },
        select: {
          tradeRef: true,
          sourceRef: true,
          amountPkr: true,
          entryDate: true,
          side: true,
          noteStatus: true,
          noteSettledByVoucherNo: true,
        },
      }),
      // When settlement equalled the rate there is no note, so the activity
      // trail is the only record of when the trade actually died.
      prisma.tradeActivity.findMany({
        where: { kind: "CANCELLED", trade: { tradeRef: { in: refs } } },
        orderBy: { at: "desc" },
        select: { at: true, summary: true, trade: { select: { tradeRef: true } } },
      }),
    ]);

    const noteByRef = new Map<string, (typeof notes)[number]>();
    for (const n of notes) if (n.tradeRef && !noteByRef.has(n.tradeRef)) noteByRef.set(n.tradeRef, n);
    const activityByRef = new Map<string, (typeof activities)[number]>();
    for (const a of activities) {
      if (!activityByRef.has(a.trade.tradeRef)) activityByRef.set(a.trade.tradeRef, a);
    }

    return cancelled.map((t) => {
      const note = noteByRef.get(t.tradeRef);
      const activity = activityByRef.get(t.tradeRef);
      return {
        id: t.id,
        tradeRef: t.tradeRef,
        direction: t.direction,
        commodityCode: t.commodity.code,
        quantity: t.quantity,
        quantityUnit: t.quantityUnit ?? t.commodity.unit,
        counterpartyName: t.counterparty.name,
        /** When the trade was cancelled — the note's date, else the activity's. */
        cancelledAt: note?.entryDate ?? activity?.at ?? t.tradeDate,
        noteRef: note?.sourceRef ?? null,
        /** DN = the seller owes us, CN = we owe the seller. */
        noteKind: note?.sourceRef?.startsWith("CN") ? ("CREDIT" as const) : note ? ("DEBIT" as const) : null,
        noteAmountPkr: note ? Number(note.amountPkr) : null,
        noteSide: note?.side ?? null,
        noteStatus: note?.noteStatus ?? null,
        noteSettledByVoucherNo: note?.noteSettledByVoucherNo ?? null,
        summary: activity?.summary ?? null,
      };
    });
  }),

  /**
   * Everything the printed debit/credit note needs, read back from the ledger
   * entry that IS the note — the paper and the books can never disagree.
   */
  settlementNoteByRef: protectedProcedure
    .input(z.object({ noteRef: z.string().min(1) }))
    .query(async ({ input }) => {
      const entry = await prisma.counterpartyLedgerEntry.findFirst({
        where: { sourceType: "ADJUSTMENT", sourceRef: input.noteRef },
        select: {
          sourceRef: true,
          side: true,
          amountPkr: true,
          entryDate: true,
          tradeRef: true,
          note: true,
          noteStatus: true,
          noteSettledAt: true,
          noteSettledByVoucherNo: true,
          counterparty: {
            select: { name: true, code: true, companyNameNtn: true, ntn: true, address: true },
          },
        },
      });
      if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });

      const trade = entry.tradeRef
        ? await prisma.trade.findUnique({
            where: { tradeRef: entry.tradeRef },
            select: {
              tradeRef: true,
              tradeDate: true,
              direction: true,
              quantity: true,
              quantityUnit: true,
              traderName: true,
              commodity: { select: { code: true, name: true } },
            },
          })
        : null;

      // The arithmetic behind the amount lives in the CEO-approved request's
      // payload — the note text is a rendering of it, not the source.
      const activity = entry.tradeRef
        ? await prisma.tradeActivity.findFirst({
            where: {
              kind: { in: ["CANCELLED", "CLOSED"] },
              trade: { tradeRef: entry.tradeRef },
            },
            orderBy: { at: "desc" },
            select: { at: true, actorName: true, summary: true },
          })
        : null;

      return {
        noteRef: entry.sourceRef!,
        kind: entry.sourceRef!.startsWith("CN") ? ("CREDIT" as const) : ("DEBIT" as const),
        side: entry.side,
        amountPkr: Number(entry.amountPkr),
        noteDate: entry.entryDate,
        narrative: entry.note,
        status: entry.noteStatus,
        settledAt: entry.noteSettledAt,
        settledByVoucherNo: entry.noteSettledByVoucherNo,
        counterparty: entry.counterparty,
        trade: trade
          ? {
              tradeRef: trade.tradeRef,
              tradeDate: trade.tradeDate,
              direction: trade.direction,
              quantity: Number(trade.quantity),
              quantityUnit: trade.quantityUnit,
              traderName: trade.traderName,
              commodityCode: trade.commodity.code,
              commodityName: trade.commodity.name,
            }
          : null,
        approval: activity,
      };
    }),

  cancelTrade: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        tradeRef: z.string(),
        reason: z.string().trim().min(3, "Give a short reason for cancelling"),
        /** Locked trades only: prices the debit note. Ignored before lock. */
        settlementPricePerMaund: z.number().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const traderName = traderNameFromSession(ctx.session.user);
        const cancelledBy = ctx.session.user.name ?? ctx.session.user.email ?? traderName;
        const ref = input.tradeRef.trim();
        const existing = await mockTradeByRefGlobal(ref);
        if (!existing) throw new Error("Trade not found");

        // Before lock: simple cancel, no money involved.
        if (existing.tradeStatus === TradeStatus.PENDING) {
          const trade = await cancelTraderTrade(traderName, ref, input.reason, cancelledBy);
          return { ok: true as const, pendingCeo: false as const, trade };
        }

        // Locked: cancellation settles in money — debit-note form + CEO approval.
        if (
          existing.tradeStatus !== TradeStatus.LOCKED &&
          existing.tradeStatus !== TradeStatus.CONFIRMED
        ) {
          throw new Error(`This trade cannot be cancelled (current: ${existing.tradeStatus})`);
        }
        if (!traderNamesMatch(existing.traderName, canonicalTraderName(traderName))) {
          throw new Error("You can only cancel your own trades");
        }
        if (input.settlementPricePerMaund == null) {
          throw new Error(
            "Cancelling a locked trade needs a settlement price per maund for the debit note",
          );
        }
        if (
          await hasOpenChangeRequest({ entityRef: ref, entityType: "TRADE", action: "CANCEL" })
        ) {
          throw new Error("A cancellation request for this trade is already awaiting the CEO");
        }

        const payload = await buildSettlementNotePayload(ref, input.settlementPricePerMaund);
        const req = await createChangeRequest({
          department: "TRADING",
          entityType: "TRADE",
          entityRef: ref,
          entityLabel: `${ref} — cancel (${payload.counterpartyName})`,
          action: "CANCEL",
          comment: input.reason,
          requestedById: ctx.session.user.id,
          requestedByName: cancelledBy,
          payload: {
            ratePerMaund: payload.ratePerMaund,
            settlementPricePerMaund: payload.settlementPricePerMaund,
            diffPerMaund: payload.diffPerMaund,
            openQtyMt: payload.openQtyMt,
            openMaunds: payload.openMaunds,
            amountPkr: payload.amountPkr,
            direction: payload.direction,
          },
          status: "PENDING_CEO",
        });
        return { ok: true as const, pendingCeo: true as const, requestId: req.id };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not cancel trade",
        });
      }
    }),

  /**
   * Debit-note preview for the cancellation form — trade rate incl commission,
   * open qty, and the ledger amount a given settlement price would post.
   */
  settlementNotePreview: protectedProcedure
    .input(
      z.object({ tradeRef: z.string(), settlementPricePerMaund: z.number().positive().optional() }),
    )
    .query(async ({ input }) => {
      const p = await buildSettlementNotePayload(input.tradeRef.trim(), input.settlementPricePerMaund);
      return p;
    }),

  /**
   * Close a locked purchase received within tolerance — no CEO involved.
   * Below the floor the client falls back to the CLOSE change request.
   */
  closeTrade: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ tradeRef: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const traderName = traderNameFromSession(ctx.session.user);
        const closedBy = ctx.session.user.name ?? ctx.session.user.email ?? traderName;
        await closeTradeWithinTolerance(traderName, input.tradeRef.trim(), closedBy);
        return { ok: true as const };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not close trade",
        });
      }
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
    const lockedContracts = await getLockedContracts({ openOnly: false });
    const contracts = lockedContracts.map((c) => ({
      tradeRef: c.tradeRef,
      commodityCode: c.commodityCode,
      quantityUnit: c.quantityUnit,
    }));
    const commodity = input?.commodityId ? await getCommodityById(input.commodityId) : null;

    const [inbound, outbound, pendingTrucks, transfers] = await Promise.all([
      getInboundReceipts(),
      getOutboundDispatches(),
      getPendingTrucks({}),
      loadStockTransfersForStock(),
    ]);

    // Physical inventory split per warehouse (summed across commodities):
    // allocated = stock from trucks/loads assigned to a trade (inbound receipts − released dispatches);
    // unallocated = gatepassed trucks not yet assigned to any trade.
    // Shifts belong to no trade but are stock we own, so they count here too —
    // without them a warehouse fed by transfers reads short of what it holds on
    // Execution → Inventory.
    const contractByRef = new Map(lockedContracts.map((c) => [c.tradeRef, c]));
    const inventoryRows = buildLocationCommodityInventory({
      inbound,
      outbound,
      pendingTrucks,
      transfers,
      commodityForTradeRef: (ref) => {
        const c = contractByRef.get(ref);
        if (!c) return null;
        return { code: c.commodityCode, name: c.commodityName, unit: c.quantityUnit };
      },
    });
    const inventoryByWarehouse = new Map<string, { allocatedMt: number; unallocatedMt: number }>();
    const stockOnHandByWarehouse = new Map<string, number>();
    for (const row of inventoryRows) {
      const key = normWarehouseName(row.warehouseName);
      const cur = inventoryByWarehouse.get(key) ?? { allocatedMt: 0, unallocatedMt: 0 };
      cur.allocatedMt += row.allocatedQty;
      cur.unallocatedMt += row.unallocatedQty;
      inventoryByWarehouse.set(key, cur);
      if (commodity && row.commodityCode === commodity.code) {
        stockOnHandByWarehouse.set(
          key,
          (stockOnHandByWarehouse.get(key) ?? 0) + row.netQty,
        );
      }
    }

    // Sell commitment already promised out of each warehouse but not yet
    // dispatched. Open SELL contracts only: their allocation lines carry the
    // qty per warehouse, and fulfilledQtyMt is kept in step with outbound
    // dispatches, so a load that leaves the yard drops out of stock and out of
    // booked together. A truck still AT_GATE counts in both — physically
    // present, already spoken for.
    const bookedByWarehouse = new Map<string, number>();
    let unassignedBookedMt = 0;
    if (commodity) {
      for (const c of lockedContracts) {
        if (c.direction !== TradeDirection.SELL) continue;
        if (c.contractStatus !== "Open") continue;
        if (c.commodityCode !== commodity.code) continue;

        const lines = c.warehouseAllocationProgress ?? [];
        if (lines.length === 0) {
          // Locked but not split across warehouses yet — the commitment is
          // real, it just cannot be attributed to a warehouse.
          unassignedBookedMt += Math.max(0, c.openQtyMt);
          continue;
        }
        for (const line of lines) {
          const key = normWarehouseName(line.warehouseName);
          bookedByWarehouse.set(
            key,
            (bookedByWarehouse.get(key) ?? 0) + Math.max(0, line.openQtyMt),
          );
        }
      }
    }

    const warehouses = computeWarehouseAvailability(
      locations,
      inbound,
      outbound,
      contracts,
      null,
      commodity
        ? { code: commodity.code, category: commodity.category, unit: commodity.unit }
        : null,
      inventoryByWarehouse,
    ).map((row) => {
      const key = normWarehouseName(row.name);
      const stockOnHandMt = commodity
        ? Math.max(0, stockOnHandByWarehouse.get(key) ?? 0)
        : null;
      const bookedQtyMt = commodity ? (bookedByWarehouse.get(key) ?? 0) : null;
      return {
        ...row,
        stockOnHandMt,
        bookedQtyMt,
        freeToSellMt:
          stockOnHandMt != null && bookedQtyMt != null
            ? Math.max(0, stockOnHandMt - bookedQtyMt)
            : null,
      };
    });

    return { warehouses, unassignedBookedMt };
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
        /** @deprecated single register — accepted but ignored. */
        side: z.enum(["BUY", "SELL"]).optional(),
        taxFilerStatus: z.enum(["FILER", "NON_FILER"]).optional(),
        country: z.string().min(1),
        kycStatus: z.enum(["VERIFIED", "PENDING", "EXPIRED", "NOT_ON_FILE"]).optional(),
        kycRef: z.string().optional(),
        kycExpires: z.coerce.date().optional(),
        companyNameNtn: z.string().optional(),
        ntn: z.string().optional(),
        contactPerson: z.string().optional(),
        contactPhone: z.string().optional(),
        address: z.string().optional(),
        bankDetails: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await addCustomCounterparty({
          name: input.name,
          type: input.type,
          taxFilerStatus: input.taxFilerStatus,
          country: input.country,
          kycStatus: input.kycStatus,
          kycRef: input.kycRef ?? null,
          kycExpires: input.kycExpires ?? null,
          companyNameNtn: input.companyNameNtn ?? null,
          ntn: input.ntn ?? null,
          contactPerson: input.contactPerson ?? null,
          contactPhone: input.contactPhone ?? null,
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

      // Booking-form contact person/number are optional and stored with the
      // counterparty once — later bookings reuse them.
      {
        const rawPerson = input.tradeParams?.contactPerson;
        const rawNumber = input.tradeParams?.contactNumber;
        const contactPerson = typeof rawPerson === "string" ? rawPerson.trim() : "";
        const contactNumber =
          rawNumber != null && rawNumber !== "" ? String(rawNumber).trim() : "";
        const patch: { contactPerson?: string; contactPhone?: string } = {};
        if (contactPerson && !cp.contactPerson) patch.contactPerson = contactPerson;
        if (contactNumber && !cp.contactPhone) patch.contactPhone = contactNumber;
        if (Object.keys(patch).length) {
          await updateCustomCounterparty(cp.id, patch);
        }
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
          season: input.season,
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
        // Ownership first: a trader can only ever lock their OWN trades —
        // no fallback to the global register.
        const existing = await mockTraderTradeByRef(traderName, input.tradeRef);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
        }
        if (existing.submittedToExecution && existing.pendingTraderReview) {
          const trade = await lockOpenTradeAfterTraderReview(traderName, input.tradeRef, {
            lockedBy: ctx.session.user.name ?? traderName,
            ratePerMaund: input.ratePerMaund,
            commissionPerMaund: input.commissionPerMaund,
            qualityTolerances: input.qualityTolerances as QualityTolerances | undefined,
          });
          return { ok: true as const, trade };
        }
        // Direct lock still passes every gate a normal lock passes.
        assertPriceReadyForLock(existing);
        assertWarehouseReadyForLock(existing);
        const trade = await lockTradeInStore(traderName, input.tradeRef, {
          lockedBy: ctx.session.user.name ?? traderName,
          ratePerMaund: input.ratePerMaund,
          commissionPerMaund: input.commissionPerMaund,
          qualityTolerances: input.qualityTolerances as QualityTolerances | undefined,
        });
        return { ok: true as const, trade };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not lock trade",
        });
      }
    }),

  submitTradeToExecution: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ tradeRef: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const traderName = traderNameFromSession(ctx.session.user);
        const trade = await submitTradeToExecution(input.tradeRef.trim(), traderName);
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

  /** The daily "Net Position" mail, computed live — one column per commodity + season. */
  seasonNetPositions: protectedProcedure.query(() => getSeasonNetPositions()),

  /** Buy and sell counterparty ledger accounts — same view as Execution → Ledgers. */
  counterpartyLedgers: protectedProcedure.query(() => getCounterpartyLedgers()),

  /** Counterparty-wise open qty, WAC, MTM, and ledger outstanding for desk reports. */
  counterpartyReport: protectedProcedure
    .input(
      z
        .object({
          counterpartyId: z.string().optional(),
          commodityCode: z.string().optional(),
          direction: z.nativeEnum(TradeDirection).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      return buildTraderCounterpartyReport(name, {
        counterpartyId: input?.counterpartyId,
        commodityCode: input?.commodityCode,
        direction: input?.direction,
      });
    }),

  /** Desk sets the day's market rate / FX behind a net-position column. */
  setPositionMarketInput: roleProcedure(["TRADER", "EXECUTION", "CEO", "ADMIN"])
    .input(
      z.object({
        commodityCode: z.string().min(1),
        season: z.enum(["WINTER", "SUMMER"]),
        marketRatePkrPerMaund: z.number().positive().nullable().optional(),
        fxRate: z.number().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setPositionMarketInput({
        ...input,
        updatedBy: ctx.session.user.name ?? ctx.session.user.email ?? "desk",
      });
      return { ok: true };
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

  // ─── Gate-invoice approvals (trader-owned trades) ─────────────────────────

  /** Gate invoices pending this trader's approval or held on old dues. */
  invoiceApprovals: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return getTraderInvoiceApprovals(name);
  }),

  /** Count of invoices awaiting approval (PENDING_TRADE_APPROVAL only) — nav badge. */
  invoiceApprovalsCount: protectedProcedure.query(async ({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    const rows = await getTraderInvoiceApprovals(name);
    return rows.filter((r) => r.stage === "PENDING_TRADE_APPROVAL").length;
  }),

  /**
   * Trader decision on a gate invoice of their own trade: APPROVE pays it in
   * full, PARTIAL pays `amountPkr` and holds the rest, HOLD parks the whole
   * invoice. A part-paid invoice stays here so the remainder can be released
   * later, in as many steps as needed.
   */
  resolveInvoiceApproval: protectedProcedure
    .input(
      z.object({
        truckId: z.string(),
        decision: z.enum(["APPROVE", "HOLD", "PARTIAL"]),
        /** PARTIAL only — how much to pay now. */
        amountPkr: z.number().positive().optional(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      try {
        const truck = await traderResolveGateInvoice(name, input.truckId, input.decision, {
          amountPkr: input.amountPkr,
          note: input.note ?? null,
        });
        return { ok: true as const, truck };
      } catch (e) {
        if (e instanceof TraderInvoiceOwnershipError) {
          throw new TRPCError({ code: "FORBIDDEN", message: e.message });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update invoice",
        });
      }
    }),

  // ─── Sell-invoice approvals (outbound sale trucks) ─────────────────────────

  /** Outbound trucks awaiting this trader: payment approvals + clear-without-payment requests. */
  sellInvoiceApprovals: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return getTraderSaleApprovals(name);
  }),

  /** Nav badge count for the Sell Invoice Approvals page. */
  sellInvoiceApprovalsCount: protectedProcedure.query(async ({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return (await getTraderSaleApprovals(name)).length;
  }),

  /**
   * Trader decision on a sell-side truck. PENDING_TRADER: approve → finance;
   * CLEAR_PENDING_TRADER: approve → CEO. Reject returns it to awaiting balance.
   */
  resolveSellInvoiceApproval: protectedProcedure
    .input(
      z.object({
        truckId: z.string(),
        decision: z.enum(["APPROVE", "REJECT"]),
        /** Required when rejecting — recorded on every portal's Rejections page. */
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      try {
        const truck = await traderResolveSaleTruck(
          name,
          input.truckId,
          input.decision,
          input.reason,
        );
        return { ok: true as const, truck };
      } catch (e) {
        if (e instanceof TraderInvoiceOwnershipError) {
          throw new TRPCError({ code: "FORBIDDEN", message: e.message });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update truck",
        });
      }
    }),

  /**
   * Standing payment reminders: trucks released on credit whose payment is
   * still outstanding, with days left until — or past — their due date.
   */
  unpaidSellTrucks: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return getTraderUnpaidSellTrucks(name);
  }),

  /** Filer / non-filer toggle in the booking pricing section — saved on the counterparty. */
  setCounterpartyFilerStatus: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({ counterpartyId: z.string(), taxFilerStatus: z.enum(["FILER", "NON_FILER"]) }),
    )
    .mutation(async ({ input }) => {
      try {
        return await updateCustomCounterparty(input.counterpartyId, {
          taxFilerStatus: input.taxFilerStatus,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update filer status",
        });
      }
    }),

  // ─── Direct trade settlement (no delivery / gatepass, CEO-approved) ────────

  /** Request to settle an unlocked trade directly — routes to the CEO. */
  requestSettlement: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ tradeRef: z.string(), note: z.string().min(1, "A settlement reason is required") }))
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      try {
        await requestTradeSettlement(name, input.tradeRef.trim(), input.note);
        return { ok: true as const };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not request settlement",
        });
      }
    }),

  cancelSettlement: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ tradeRef: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      try {
        await cancelTradeSettlement(name, input.tradeRef.trim());
        return { ok: true as const };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not cancel settlement",
        });
      }
    }),

  // ─── Settlement collection (settled trades: invoices → vouchers → ledger) ───

  /** Settled trades with collection progress — the Settled tab in My Trades. */
  settledTrades: protectedProcedure.query(({ ctx }) =>
    listSettledTrades(traderNameFromSession(ctx.session.user)),
  ),

  /** Count for the Settled tab badge. */
  mySettledCount: protectedProcedure.query(async ({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return (await listSettledTrades(name)).length;
  }),

  /** Full settlement picture for one settled trade — target, invoices, money in. */
  tradeSettlement: protectedProcedure
    .input(z.object({ tradeRef: z.string() }))
    .query(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      const view = await getTradeSettlement(input.tradeRef.trim());
      if (!view) return null;
      if (!traderNamesMatch(view.traderName, canonicalTraderName(name))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your trade" });
      }
      return view;
    }),

  /** Raise a settlement invoice — posts the receivable onto the ledger. */
  raiseSettlementInvoice: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        tradeRef: z.string(),
        amountPkr: z.number().positive("Invoice amount must be more than zero"),
        dueDate: z.date().optional(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      const view = await getTradeSettlement(input.tradeRef.trim());
      if (!view) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This trade is not settled" });
      }
      if (!traderNamesMatch(view.traderName, canonicalTraderName(name))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your trade" });
      }
      try {
        return await raiseSettlementInvoice({
          tradeRef: input.tradeRef.trim(),
          amountPkr: input.amountPkr,
          dueDate: input.dueDate ?? null,
          note: input.note ?? null,
          createdById: ctx.session.user.id,
          actorName: ctx.session.user.name ?? name,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not raise the settlement invoice",
        });
      }
    }),

  /** Void a settlement invoice raised in error — removes its ledger debit. */
  voidSettlementInvoice: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ tradeRef: z.string(), invoiceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      const view = await getTradeSettlement(input.tradeRef.trim());
      if (!view) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This trade is not settled" });
      }
      if (!traderNamesMatch(view.traderName, canonicalTraderName(name))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your trade" });
      }
      try {
        await voidSettlementInvoice({
          tradeRef: input.tradeRef.trim(),
          invoiceId: input.invoiceId,
          actorName: ctx.session.user.name ?? name,
        });
        return { ok: true as const };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not void the settlement invoice",
        });
      }
    }),

  // ─── Inbound over-delivery approvals (buy side) ────────────────────────────

  /** Over-tolerance inbound trucks awaiting this trader's approval. */
  overDeliveryApprovals: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return getTraderInboundOverDeliveries(name);
  }),

  overDeliveryApprovalsCount: protectedProcedure.query(async ({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return (await getTraderInboundOverDeliveries(name)).length;
  }),

  /** Approve (→ CEO) or reject (reason required) an over-delivery request. */
  resolveOverDeliveryApproval: protectedProcedure
    .input(
      z.object({
        truckId: z.string(),
        decision: z.enum(["APPROVE", "REJECT"]),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      try {
        const truck = await traderResolveInboundOverDelivery(
          name,
          input.truckId,
          input.decision,
          input.reason,
        );
        return { ok: true as const, truck };
      } catch (e) {
        if (e instanceof TraderInvoiceOwnershipError) {
          throw new TRPCError({ code: "FORBIDDEN", message: e.message });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update over-delivery",
        });
      }
    }),

  // ─── Execution-edit approvals (exact change diffs) ─────────────────────────

  /**
   * Trades of this trader edited by execution and awaiting approval — each
   * with the latest execution edit's summary and raw field patch so the page
   * can show the exact change.
   */
  executionEditApprovals: protectedProcedure.query(async ({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    const trades = (await mockTraderTrades(name)).filter((t) => t.pendingTraderReview);
    return Promise.all(
      trades.map(async (t) => {
        const log = await getTradeActivityLog(t.tradeRef);
        const lastEdit =
          [...log]
            .filter((e) => e.actorSide === "EXECUTION" && e.kind === "EDIT_APPLIED")
            .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
            .at(-1) ?? null;
        return {
          tradeRef: t.tradeRef,
          direction: t.direction,
          commodityName: t.commodity.name,
          commodityCode: t.commodity.code,
          counterpartyName: t.counterparty.name,
          quantity: t.quantity,
          quantityUnit: t.quantityUnit,
          editedBy: t.executionLastEditedBy ?? lastEdit?.actorName ?? null,
          editedAt: t.executionLastEditedAt ?? lastEdit?.at ?? null,
          editNote: t.executionEditNote ?? null,
          changeSummary: lastEdit?.summary ?? null,
          changeCount: lastEdit?.changeCount ?? null,
          /** Raw execution patch — field → new value. */
          changes: lastEdit?.payload ?? null,
        };
      }),
    );
  }),

  /** Nav badge count for the trade-change approvals page. */
  executionEditApprovalsCount: protectedProcedure.query(async ({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return (await mockTraderTrades(name)).filter((t) => t.pendingTraderReview).length;
  }),

  /** Approve execution's changes so execution can lock the trade. */
  approveExecutionEdits: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ tradeRef: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      try {
        const trade = await traderApproveExecutionEdits(name, input.tradeRef.trim());
        return { ok: true as const, trade };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not approve changes",
        });
      }
    }),

  // ─── Booking drafts (autosaved unfinished forms) ───────────────────────────

  /** Unfinished booking drafts for the My Trades page, newest first. */
  bookingDrafts: protectedProcedure.query(({ ctx }) => {
    const name = traderNameFromSession(ctx.session.user);
    return listTradeDrafts(name);
  }),

  bookingDraft: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      return getTradeDraft(name, input.id);
    }),

  /** Autosave the booking form; returns the draft id to keep writing to. */
  saveBookingDraft: roleProcedure(["TRADER", "ADMIN"])
    .input(
      z.object({
        id: z.string().nullish(),
        payload: z.record(z.string(), z.unknown()),
        summary: z
          .object({
            commodityLabel: z.string().nullish(),
            counterpartyLabel: z.string().nullish(),
            direction: z.string().nullish(),
            quantityLabel: z.string().nullish(),
          })
          .nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      try {
        return await upsertTradeDraft(name, {
          id: input.id ?? null,
          payload: input.payload,
          summary: input.summary ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not save draft",
        });
      }
    }),

  deleteBookingDraft: roleProcedure(["TRADER", "ADMIN"])
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const name = traderNameFromSession(ctx.session.user);
      try {
        return await deleteTradeDraft(name, input.id);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not delete draft",
        });
      }
    }),
});

export type TraderTrade = Awaited<ReturnType<typeof mockTraderTrades>>[number];

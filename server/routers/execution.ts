import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Role } from "@prisma/client";
import { EXECUTION_PROFILES, TRADE_SCOPES } from "@/lib/trade-constants";
import { headProcedure, roleProcedure, router } from "@/server/trpc/trpc";
import {
  advanceSpotState,
  allocateContractWarehouse,
  allocateContractWarehousesSplit,
  assignTruckToTrade,
  createPendingTruck,
  deleteInboundReceipt,
  deleteOutboundDispatch,
  deletePendingTruck,
  exportLockedContractsCsv,
  exportMovementsCsv,
  getContractByRef,
  getContractsPendingWarehouseAllocation,
  getDeskSummary,
  getInboundReceipts,
  getLockedContracts,
  getPendingTradesForExecution,
  getGateInvoiceSummary,
  getPendingTrucks,
  getOutboundDispatches,
  getSpotEvent,
  setGateInvoiceStage,
  setManualGateInvoice,
  withWarehouseProgress,
  listSpotPipeline,
  submitInboundForFinance,
  submitSpotForFinance,
  updatePendingTruck,
  updateInboundReceipt,
  updateOutboundDispatch,
  getSaleWorkflowRows,
  getSaleTruckPrintable,
  markSaleTruckReleased,
  confirmSalePayment,
  requestClearWithoutPayment,
} from "@/server/execution-store";
import { getCounterpartyLedgers } from "@/server/finance/ledger";
import { createVoucher, listVouchers } from "@/server/finance/vouchers";
import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import {
  addCustomLocation,
  deleteWarehouseLocation,
  getCompanyWarehouses,
  getMergedCounterparties,
  getMergedLocations,
  updateWarehouseLocation,
} from "@/server/trader-master-data";
import {
  exportTradeFileCsv,
  previewTradeFile,
  tradeFileFilterOptions,
} from "@/server/trade-file-export";
import { computePositionLedger, setPositionAdjustment } from "@/server/position-ledger";
import {
  getOpenTradeByRef,
  getOpenTradesForExecution,
  getOpenTradesNeedingWarehouseAllocation,
  applyOpenTradeWarehouseSplit,
  getLockedTradeByRef,
  lockOpenTradeFromExecution,
  updateLockedTradeDirect,
  updateOpenTradeDirect,
} from "@/server/open-trades";
import { getTradeTimeline } from "@/server/trade-activity";
import { PRICE_CURRENCIES } from "@/lib/price-units";
import { GATE_INVOICE_STAGES } from "@/lib/gate-invoice";

const warehouseLaborLineSchema = z.object({
  role: z.string().trim().min(1),
  headcount: z.number().nonnegative(),
  unitCostPkr: z.number().nonnegative(),
});

const warehouseLocationFieldsSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().optional(),
  lsp: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  province: z.string().trim().optional(),
  capacitySqFt: z.number().positive().optional(),
  costPerSqFt: z.number().nonnegative().optional(),
  balesDivisionSqFt: z.number().positive().optional(),
  grainDivisionSqFt: z.number().positive().optional(),
  serviceStartDate: z.string().trim().optional(),
  rentalTaxPkr: z.number().nonnegative().optional(),
  managementFeePct: z.number().nonnegative().optional(),
  hiringPeriodMonths: z.number().int().positive().optional(),
  laborLines: z.array(warehouseLaborLineSchema).optional(),
});

const qualitySchema = z.object({
  damagePct: z.number().min(0),
  brokenPct: z.number().min(0),
  fungusPct: z.number().min(0),
  foreignMatterPct: z.number().min(0),
  moisturePct: z.number().min(0),
});

const openTradePatchSchema = z.object({
  quantityEntered: z.number().positive().optional(),
  quantityEnteredUnit: z.string().trim().min(1).optional(),
  price: z.number().positive().optional(),
  priceCurrency: z.enum(PRICE_CURRENCIES).optional(),
  priceWeightUnit: z.string().trim().min(1).optional(),
  priceKgPerUnit: z.number().positive().optional(),
  priceBasis: z.string().optional(),
  commissionAmount: z.number().min(0).nullable().optional(),
  deliveryStart: z.coerce.date().optional(),
  deliveryEnd: z.coerce.date().optional(),
  originName: z.string().optional(),
  destName: z.string().optional(),
  productOrigin: z.string().optional(),
  grade: z.string().optional(),
  incoterms: z.string().optional(),
  paymentType: z
    .enum(["DP", "LC", "CAD", "ADVANCE_100", "CREDIT", "CREDIT_30", "AFTER_DELIVERY_100"])
    .optional(),
  creditDays: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
  qualityTolerances: z.string().optional(),
  qualityTolerancesDetail: qualitySchema.optional(),
  maxMoisturePct: z.number().min(0).max(100).nullable().optional(),
  tradeParams: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
  warehouseSelections: z.array(z.string().trim().min(1)).optional(),
  warehouseSplit: z
    .array(
      z.object({
        warehouseName: z.string().trim().min(1),
        openQtyMt: z.number().nonnegative(),
      }),
    )
    .optional(),
  executionEditNote: z.string().nullable().optional(),
  counterparty: z
    .object({
      name: z.string().trim().min(1).optional(),
      companyNameNtn: z.string().nullable().optional(),
      ntn: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      bankDetails: z.string().nullable().optional(),
      verify: z.boolean().optional(),
    })
    .optional(),
});

const execRoles: Role[] = [Role.EXECUTION, Role.ADMIN];

const tradeFileFilterSchema = z.object({
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
});

export const executionRouter = router({
  deskSummary: roleProcedure([...execRoles]).query(() => getDeskSummary()),

  // ── Head-of-execution direct deletions ──────────────────────────────────
  deleteGateEntry: headProcedure("EXECUTION")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await deletePendingTruck(input.id);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  updateGateEntry: headProcedure("EXECUTION")
    .input(
      z.object({
        id: z.string(),
        truckNo: z.string().trim().min(1).optional(),
        weightKg: z.number().positive().optional(),
        weightAsPerBuiltyKg: z.number().positive().nullable().optional(),
        bags: z.number().int().nonnegative().nullable().optional(),
        quantityBagsBales: z.number().int().nonnegative().nullable().optional(),
        warehouseName: z.string().trim().min(1).optional(),
        counterpartyName: z.string().trim().min(1).optional(),
        transporterName: z.string().nullable().optional(),
        transporterPhone: z.string().nullable().optional(),
        builtyDetails: z.string().trim().optional(),
        quantityAsPerBuilty: z.string().nullable().optional(),
        weighBridgeName: z.string().nullable().optional(),
        warehouseWeightKg: z.number().nonnegative().nullable().optional(),
        qualitySpecs: qualitySchema.nullable().optional(),
        totalDeductionsKg: z.number().nonnegative().nullable().optional(),
        documentRefs: z.array(z.string().trim().min(1)).optional(),
        remarks: z.string().nullable().optional(),
        commodityCode: z.string().trim().optional(),
        commodityName: z.string().trim().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const { id, ...patch } = input;
        return await updatePendingTruck(id, patch);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  updateInboundReceipt: headProcedure("EXECUTION")
    .input(
      z.object({
        id: z.string(),
        gatepassNo: z.string().nullable().optional(),
        truckNo: z.string().trim().min(1).optional(),
        warehouseName: z.string().trim().min(1).optional(),
        sellerName: z.string().trim().min(1).optional(),
        driverName: z.string().nullable().optional(),
        driverPhone: z.string().nullable().optional(),
        biltyNo: z.string().trim().optional(),
        bags: z.number().int().nonnegative().nullable().optional(),
        weightSpotKg: z.number().positive().optional(),
        weightWarehouseKg: z.number().positive().optional(),
        remarks: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const { id, ...patch } = input;
        return await updateInboundReceipt(id, patch);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  updateOutboundDispatch: headProcedure("EXECUTION")
    .input(
      z.object({
        id: z.string(),
        gatepassNo: z.string().nullable().optional(),
        truckNo: z.string().trim().min(1).optional(),
        warehouseName: z.string().trim().min(1).optional(),
        buyerName: z.string().trim().min(1).optional(),
        liftedBy: z.string().trim().min(1).optional(),
        driverName: z.string().nullable().optional(),
        driverPhone: z.string().nullable().optional(),
        dispatchWeightKg: z.number().positive().optional(),
        invoiceWeightKg: z.number().positive().optional(),
        doRef: z.string().nullable().optional(),
        remarks: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const { id, ...patch } = input;
        return await updateOutboundDispatch(id, patch);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  deleteInboundReceipt: headProcedure("EXECUTION")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await deleteInboundReceipt(input.id);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  deleteOutboundDispatch: headProcedure("EXECUTION")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await deleteOutboundDispatch(input.id);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  pendingForLock: roleProcedure([...execRoles]).query(() => {
    return getPendingTradesForExecution();
  }),

  openTrades: roleProcedure([...execRoles]).query(() => {
    return getOpenTradesForExecution();
  }),

  openTradeByRef: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string() }))
    .query(({ input }) => {
      return getOpenTradeByRef(input.tradeRef.trim());
    }),

  tradeTimeline: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string() }))
    .query(async ({ input }) => {
      const ref = input.tradeRef.trim();
      const open = await getOpenTradeByRef(ref);
      if (!open && !(await getLockedTradeByRef(ref))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
      }
      return getTradeTimeline(ref);
    }),

  updateOpenTrade: headProcedure("EXECUTION")
    .input(z.object({ tradeRef: z.string(), patch: openTradePatchSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        const editedBy = ctx.session.user.name ?? ctx.session.user.email ?? "execution";
        return await updateOpenTradeDirect(input.tradeRef.trim(), input.patch, editedBy);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update open trade",
        });
      }
    }),

  lockOpenTrade: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string(), patch: openTradePatchSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const lockedBy = ctx.session.user.name ?? ctx.session.user.email ?? "execution";
        return await lockOpenTradeFromExecution(input.tradeRef.trim(), lockedBy, input.patch);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not lock trade",
        });
      }
    }),

  lockedTradeByRef: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string() }))
    .query(({ input }) => {
      return getLockedTradeByRef(input.tradeRef.trim());
    }),

  updateLockedTrade: headProcedure("EXECUTION")
    .input(z.object({ tradeRef: z.string(), patch: openTradePatchSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        const editedBy = ctx.session.user.name ?? ctx.session.user.email ?? "execution";
        return await updateLockedTradeDirect(input.tradeRef.trim(), input.patch, editedBy);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update locked contract",
        });
      }
    }),

  pendingWarehouseAllocation: roleProcedure([...execRoles]).query(() => {
    return getOpenTradesNeedingWarehouseAllocation();
  }),

  approveOpenTradeWarehouseSplit: headProcedure("EXECUTION")
    .input(
      z.object({
        tradeRef: z.string(),
        allocations: z
          .array(
            z.object({
              warehouseName: z.string().trim().min(1),
              openQtyMt: z.number().positive(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const by = ctx.session.user.name ?? ctx.session.user.email ?? "execution";
        return await applyOpenTradeWarehouseSplit(input.tradeRef.trim(), input.allocations, by, true);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not approve warehouse allocation",
        });
      }
    }),

  warehouseLocations: roleProcedure([...execRoles]).query(() => getMergedLocations()),

  companyWarehouses: roleProcedure([...execRoles]).query(async () =>
    (await getCompanyWarehouses()).map((w) => ({ id: w.id, name: w.name, code: w.code ?? null })),
  ),

  // Execution head allocates each locked contract to a company warehouse (local + international).
  allocateWarehouse: headProcedure("EXECUTION")
    .input(z.object({ tradeRef: z.string(), warehouseName: z.string().nullable() }))
    .mutation(async ({ input }) => {
      try {
        const result = await allocateContractWarehouse(input.tradeRef, input.warehouseName);
        return withWarehouseProgress(result);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  allocateWarehouseSplit: headProcedure("EXECUTION")
    .input(
      z.object({
        tradeRef: z.string(),
        allocations: z
          .array(
            z.object({
              warehouseName: z.string().trim().min(1),
              openQtyMt: z.number().nonnegative(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await allocateContractWarehousesSplit(input.tradeRef, input.allocations);
        return withWarehouseProgress(result);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  addWarehouseLocation: headProcedure("EXECUTION")
    .input(warehouseLocationFieldsSchema)
    .mutation(async ({ input }) => {
      try {
        return await addCustomLocation({
          ...input,
          capacitySqFt: input.capacitySqFt ?? 1,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not add warehouse",
        });
      }
    }),

  updateWarehouseLocation: headProcedure("EXECUTION")
    .input(warehouseLocationFieldsSchema.partial().extend({ id: z.string() }))
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      try {
        return await updateWarehouseLocation(id, patch);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update warehouse",
        });
      }
    }),

  deleteWarehouseLocation: headProcedure("EXECUTION")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await deleteWarehouseLocation(input.id);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not delete warehouse",
        });
      }
    }),

  lockedContracts: roleProcedure([...execRoles])
    .input(
      z
        .object({
          profile: z.enum(EXECUTION_PROFILES).optional(),
          incoterms: z.string().optional(),
          tradeScope: z.enum(TRADE_SCOPES).optional(),
          openOnly: z.boolean().optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          warehouseName: z.string().optional(),
          warehouseAllocated: z.boolean().optional(),
          warehouseUnallocated: z.boolean().optional(),
        })
        .optional(),
    )
    .query(({ input }) => getLockedContracts(input ?? undefined)),

  contractByRef: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string() }))
    .query(async ({ input }) => {
      const c = await getContractByRef(input.tradeRef.trim());
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found or trade not locked yet" });
      const [inbound, outbound, spot] = await Promise.all([
        getInboundReceipts(input.tradeRef),
        getOutboundDispatches(input.tradeRef),
        getSpotEvent(input.tradeRef),
      ]);
      return { contract: c, inbound, outbound, spot };
    }),

  exportLockedCsv: roleProcedure([...execRoles, Role.TRADER])
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        profile: z.enum(EXECUTION_PROFILES).optional(),
        incoterms: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const csv = await exportLockedContractsCsv(input.from, input.to, input.profile, input.incoterms);
      return {
        csv,
        filename: `locked-trades-${input.from.toISOString().slice(0, 10)}.csv`,
      };
    }),

  submitInboundForFinance: roleProcedure([...execRoles])
    .input(z.object({ receiptId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await submitInboundForFinance(input.receiptId);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  inboundReceipts: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string().optional() }).optional())
    .query(({ input }) => getInboundReceipts(input?.tradeRef)),

  // Legacy outbound release path removed — sale trucks release only via the
  // payment workflow (confirmSalePayment / CEO clearance + markSaleReleased).

  outboundDispatches: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string().optional() }).optional())
    .query(({ input }) => getOutboundDispatches(input?.tradeRef)),

  spotPipeline: roleProcedure([...execRoles])
    .input(z.object({ profile: z.enum(["PURCHASE_SPOT"]).optional() }).optional())
    .query(({ input }) => listSpotPipeline(input?.profile ?? "PURCHASE_SPOT")),

  advanceSpot: roleProcedure([...execRoles])
    .input(
      z.object({
        tradeRef: z.string(),
        state: z.enum([
          "CONTRACT",
          "SELECTED",
          "LOADED",
          "DC_ISSUED",
          "INVOICED",
          "FINANCE_PENDING",
          "PAID",
          "ON_THE_WAY",
          "RECEIVED",
        ]),
        selectorNotes: z.string().optional(),
        brokerName: z.string().optional(),
        dcNo: z.string().optional(),
        truckNo: z.string().optional(),
        spotWeightKg: z.number().optional(),
        brokerInvoiceRef: z.string().optional(),
        invoiceAmount: z.number().optional(),
        warehouseReceiveWeightKg: z.number().optional(),
      }),
    )
    .mutation(({ input }) => {
      const { tradeRef, state, ...patch } = input;
      return advanceSpotState(tradeRef, state, patch);
    }),

  submitSpotForFinance: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await submitSpotForFinance(input.tradeRef);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  // Payment approval lives with FINANCE only — execution raises requests but
  // can never approve or reject its own (separation of duties).

  // ─── Pending Truck procedures ─────────────────────────────────────────────

  pendingTrucks: roleProcedure([...execRoles])
    .input(
      z.object({
        counterpartyName: z.string().optional(),
        warehouseName: z.string().optional(),
        movementType: z.enum(["INBOUND", "OUTBOUND"]).optional(),
        status: z.enum(["PENDING", "ASSIGNED", "PARTIAL"]).optional(),
        /** Trucks whose gate workflow is incomplete (missing trade assignment or, inbound, an invoice). */
        incompleteOnly: z.boolean().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }).optional(),
    )
    .query(({ input }) => getPendingTrucks(input ?? undefined)),

  createPendingTruck: roleProcedure([...execRoles])
    .input(
      z.object({
        counterpartyName: z.string().min(1),
        movementType: z.enum(["INBOUND", "OUTBOUND"]),
        warehouseName: z.string().min(1),
        truckNo: z.string().min(1),
        transporterName: z.string().optional(),
        transporterPhone: z.string().optional(),
        builtyDetails: z.string().min(1),
        commodityCode: z.string().min(1),
        commodityName: z.string().min(1),
        recordedByName: z.string().min(1),
        quantityAsPerBuilty: z.string().optional(),
        weightAsPerBuiltyKg: z.number().positive(),
        weighBridgeName: z.string().optional(),
        documentRefs: z.array(z.string().trim().min(1)).optional(),
        warehouseWeightKg: z.number().nonnegative().optional(),
        qualitySpecs: qualitySchema.optional(),
        quantityBagsBales: z.number().nonnegative().optional(),
        totalDeductionsKg: z.number().nonnegative().optional(),
        remarks: z.string().optional(),
        gatepassNo: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await createPendingTruck({
          ...input,
          weightKg: input.weightAsPerBuiltyKg,
          transporterName: input.transporterName || null,
          transporterPhone: input.transporterPhone || null,
          quantityAsPerBuilty: input.quantityAsPerBuilty || null,
          weighBridgeName: input.weighBridgeName || null,
          warehouseWeightKg: input.warehouseWeightKg ?? null,
          qualitySpecs: input.qualitySpecs ?? null,
          quantityBagsBales: input.quantityBagsBales ?? null,
          totalDeductionsKg: input.totalDeductionsKg ?? null,
          remarks: input.remarks || null,
          gatepassNo: input.gatepassNo || null,
        });
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  assignTruckToTrade: roleProcedure([...execRoles])
    .input(
      z.object({
        truckId: z.string(),
        tradeRef: z.string(),
        overrideWeightKg: z.number().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        // Physical gate receipt — record fulfilment even if booked delivery window has not opened yet.
        return await assignTruckToTrade(
          input.truckId,
          input.tradeRef,
          input.overrideWeightKg,
          true,
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  // ─── Gate-invoice workflow ────────────────────────────────────────────────

  // Enter OR edit a gate invoice — repeated calls update invoiceNo/amount and
  // re-validate the stage against the expected amount (match → pending trade
  // approval, mismatch → wrong invoicing). Editing a PAYMENT_APPROVED invoice
  // is rejected until its stage is changed.
  setManualGateInvoice: roleProcedure([...execRoles])
    .input(
      z.object({
        truckId: z.string(),
        invoiceNo: z.string().trim().min(1),
        amountPkr: z.number().positive(),
        tradeRef: z.string().trim().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await setManualGateInvoice(input.truckId, {
          invoiceNo: input.invoiceNo,
          amountPkr: input.amountPkr,
          tradeRef: input.tradeRef || null,
        });
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  // Payment approval is reserved for the trade's trader (Invoice approvals page);
  // only CEO/ADMIN may set PAYMENT_APPROVED from the execution stage dropdown.
  setGateInvoiceStage: roleProcedure([...execRoles])
    .input(z.object({ truckId: z.string(), stage: z.enum(GATE_INVOICE_STAGES) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await setGateInvoiceStage(input.truckId, input.stage, {
          actorRole: ctx.session.user.role,
        });
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  gateInvoiceSummary: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string() }))
    .query(async ({ input }) => {
      try {
        return await getGateInvoiceSummary(input.tradeRef);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  exportMovementsCsv: roleProcedure([...execRoles])
    .input(
      z.object({
        warehouseName: z.string().optional(),
        commodityCode: z.string().optional(),
        movementType: z.enum(["INBOUND", "OUTBOUND", "ALL"]).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }).optional(),
    )
    .mutation(async ({ input }) => {
      const csv = await exportMovementsCsv(input ?? undefined);
      const today = new Date().toISOString().slice(0, 10);
      return { csv, filename: `movements-${today}.csv` };
    }),

  tradeFileOptions: roleProcedure([...execRoles, Role.TRADER]).query(() => tradeFileFilterOptions()),

  tradeFilePreview: roleProcedure([...execRoles, Role.TRADER])
    .input(tradeFileFilterSchema.optional())
    .query(({ input }) => previewTradeFile(input ?? undefined)),

  exportTradeFileCsv: roleProcedure([...execRoles, Role.TRADER])
    .input(tradeFileFilterSchema.optional())
    .mutation(async ({ input }) => {
      const csv = await exportTradeFileCsv(input ?? undefined);
      const stamp = new Date().toISOString().slice(0, 10);
      return { csv, filename: `trade-file-${stamp}.csv` };
    }),

  positionLedger: roleProcedure([...execRoles, Role.TRADER]).query(() => computePositionLedger()),

  setPositionAdjustment: headProcedure("EXECUTION")
    .input(
      z.object({
        commodityCode: z.string().min(1),
        deltaMt: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      await setPositionAdjustment(input.commodityCode, input.deltaMt);
      return computePositionLedger();
    }),

  // ─── Outbound sale payment workflow ────────────────────────────────────────

  /** Outbound trucks in the sale workflow with per-buyer ledger credit state. */
  saleWorkflowRows: roleProcedure([...execRoles]).query(() => getSaleWorkflowRows()),

  /**
   * Confirm payment for a truck — succeeds when the buyer's approved voucher
   * credit covers the receivable; no trader/finance approval needed. Issues
   * the Gate Out Slip + Delivery Order.
   */
  confirmSalePayment: roleProcedure([...execRoles])
    .input(z.object({ truckId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmSalePayment(
          input.truckId,
          ctx.session.user.name ?? ctx.session.user.email ?? "execution",
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  /**
   * Manual release toggle — printed Gate Out Slip + Delivery Order handed to
   * the warehouse manager. Flips the gate register entry to RELEASED.
   */
  markSaleReleased: roleProcedure([...execRoles])
    .input(z.object({ truckId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await markSaleTruckReleased(
          input.truckId,
          ctx.session.user.name ?? ctx.session.user.email ?? "execution",
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  /** Clear-without-payment path: trader approval, then CEO approval. */
  requestClearWithoutPayment: roleProcedure([...execRoles])
    .input(z.object({ truckId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await requestClearWithoutPayment(input.truckId);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  /** Printable Gate Out Slip / Delivery Order data for a released truck. */
  saleTruckPrintable: roleProcedure([...execRoles, Role.FINANCE, Role.CEO])
    .input(z.object({ truckId: z.string() }))
    .query(async ({ input }) => {
      try {
        return await getSaleTruckPrintable(input.truckId);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  // ─── Counterparty ledgers & payment vouchers ───────────────────────────────

  /** SELL-side counterparty ledgers (mirror of Finance → Counterparty Ledgers). */
  counterpartyLedgers: roleProcedure([...execRoles, Role.FINANCE]).query(() =>
    getCounterpartyLedgers(),
  ),

  /** Counterparties for the voucher entry dropdown (single unified register). */
  sellCounterparties: roleProcedure([...execRoles, Role.FINANCE]).query(async () =>
    (await getMergedCounterparties()).map((cp) => ({
      id: cp.id,
      name: cp.name,
      code: cp.code,
    })),
  ),

  /**
   * Open SELL trades of a counterparty — the voucher form's "against trade"
   * dropdown (or direct advance).
   */
  sellTradesForCounterparty: roleProcedure([...execRoles, Role.FINANCE])
    .input(z.object({ counterpartyId: z.string().min(1) }))
    .query(async ({ input }) => {
      const trades = await prisma.trade.findMany({
        where: {
          counterpartyId: input.counterpartyId,
          direction: "SELL",
          tradeStatus: { in: ["LOCKED", "CONFIRMED", "PENDING"] },
        },
        orderBy: { tradeDate: "desc" },
        select: { tradeRef: true, paymentType: true, quantity: true, quantityUnit: true },
        take: 50,
      });
      return trades.map((t) => ({
        tradeRef: t.tradeRef,
        paymentType: t.paymentType,
        quantity: num(t.quantity),
        quantityUnit: t.quantityUnit,
      }));
    }),

  /** Enter a payment voucher — credits the ledger once finance approves it. */
  createVoucher: roleProcedure([...execRoles])
    .input(
      z.object({
        counterpartyId: z.string().min(1),
        /** Sell trade the payment is against; omit for a direct advance. */
        tradeRef: z.string().optional(),
        amountPkr: z.number().positive(),
        method: z.string().optional(),
        reference: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createVoucher({
          ...input,
          enteredByName: ctx.session.user.name ?? ctx.session.user.email ?? "execution",
        });
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  vouchers: roleProcedure([...execRoles, Role.FINANCE])
    .input(
      z
        .object({
          status: z.enum(["PENDING_FINANCE", "APPROVED", "REJECTED"]).optional(),
          counterpartyId: z.string().optional(),
        })
        .optional(),
    )
    .query(({ input }) => listVouchers(input ?? undefined)),

  // ─── Inventory valuation (execution inventory stat cards) ─────────────────

  /**
   * Stock-weighted average purchase price across all inbound receipts
   * (Σ receipt qty × its trade's contract rate ÷ Σ receipt qty, PKR/MT) and
   * the total quantity dispatched to buyers (MT).
   */
  inventoryValuation: roleProcedure([...execRoles]).query(async () => {
    const [inboundByTrade, outboundAgg, contracts] = await Promise.all([
      prisma.inboundReceipt.groupBy({
        by: ["tradeRef"],
        _sum: { allocatedQtyMt: true },
      }),
      prisma.outboundDispatch.aggregate({ _sum: { allocatedQtyMt: true } }),
      prisma.executionContract.findMany({
        select: { tradeRef: true, ratePerKg: true, ratePerMaund: true },
      }),
    ]);

    // Contract rate in PKR/MT — prefer ratePerKg × 1000, fall back to ratePerMaund × 25 (1000 kg / 40 kg).
    const ratePkrPerMtByRef = new Map<string, number>();
    for (const c of contracts) {
      const perKg = c.ratePerKg != null ? num(c.ratePerKg) : null;
      const perMaund = c.ratePerMaund != null ? num(c.ratePerMaund) : null;
      const rate = perKg != null && perKg > 0 ? perKg * 1000 : perMaund != null && perMaund > 0 ? perMaund * 25 : null;
      if (rate != null) ratePkrPerMtByRef.set(c.tradeRef, rate);
    }

    let totalPurchasedMt = 0;
    let ratedQtyMt = 0;
    let ratedValuePkr = 0;
    for (const g of inboundByTrade) {
      const qty = num(g._sum.allocatedQtyMt);
      if (qty <= 0) continue;
      totalPurchasedMt += qty;
      const rate = ratePkrPerMtByRef.get(g.tradeRef);
      if (rate != null) {
        ratedQtyMt += qty;
        ratedValuePkr += qty * rate;
      }
    }

    return {
      weightedPurchasePricePkrPerMt: ratedQtyMt > 0 ? ratedValuePkr / ratedQtyMt : 0,
      totalPurchasedMt,
      totalSoldMt: num(outboundAgg._sum.allocatedQtyMt),
    };
  }),
});

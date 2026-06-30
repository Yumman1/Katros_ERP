import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Role } from "@prisma/client";
import { EXECUTION_PROFILES, TRADE_SCOPES } from "@/lib/trade-constants";
import { roleProcedure, router } from "@/server/trpc/trpc";
import { isMockMode } from "@/server/mock-mode";
import {
  advanceSpotState,
  approvePayment,
  assignTruckToTrade,
  assignTruckFifoAuto,
  createInboundReceipt,
  createOutboundDispatch,
  createPendingTruck,
  exportLockedContractsCsv,
  exportMovementsCsv,
  getContractByRef,
  getDeskSummary,
  getInboundReceipts,
  getLockedContracts,
  getPaymentRequests,
  getPendingTradesForExecution,
  getPendingTrucks,
  getOutboundDispatches,
  getSpotEvent,
  listSpotPipeline,
  releaseOutbound,
  rejectPayment,
  requestOutboundRelease,
  seedExecutionDemoIfEmpty,
  submitInboundForFinance,
  submitSpotForFinance,
  suggestInboundFifo,
  suggestSaleFifo,
  syncAllLockedContracts,
  syncExecutionFromDisk,
} from "@/server/execution-store";
import { addCustomLocation, getMergedLocations, updateWarehouseLocation } from "@/server/trader-master-data";

const qualitySchema = z.object({
  damagePct: z.number().min(0),
  brokenPct: z.number().min(0),
  fungusPct: z.number().min(0),
  foreignMatterPct: z.number().min(0),
  moisturePct: z.number().min(0),
});

const execRoles: Role[] = [Role.EXECUTION, Role.ADMIN];

export const executionRouter = router({
  deskSummary: roleProcedure([...execRoles]).query(() => {
    if (isMockMode()) seedExecutionDemoIfEmpty();
    return getDeskSummary();
  }),

  pendingForLock: roleProcedure([...execRoles]).query(() => {
    syncAllLockedContracts();
    return getPendingTradesForExecution();
  }),

  warehouseLocations: roleProcedure([...execRoles]).query(() => getMergedLocations()),

  addWarehouseLocation: roleProcedure([...execRoles])
    .input(
      z.object({
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
      }),
    )
    .mutation(({ input }) => {
      if (!isMockMode()) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Warehouse creation only in mock mode" });
      }
      try {
        return addCustomLocation(input);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not add warehouse",
        });
      }
    }),

  updateWarehouseLocation: roleProcedure([...execRoles])
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).optional(),
        code: z.string().trim().optional(),
        lsp: z.string().trim().optional(),
        address: z.string().trim().optional(),
        city: z.string().trim().optional(),
        province: z.string().trim().optional(),
        capacitySqFt: z.number().positive().optional(),
        costPerSqFt: z.number().nonnegative().optional(),
        balesDivisionSqFt: z.number().positive().optional(),
        grainDivisionSqFt: z.number().positive().optional(),
      }),
    )
    .mutation(({ input }) => {
      if (!isMockMode()) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Warehouse update only in mock mode" });
      }
      const { id, ...patch } = input;
      try {
        return updateWarehouseLocation(id, patch);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not update warehouse",
        });
      }
    }),

  lockedContracts: roleProcedure([...execRoles])
    .input(
      z
        .object({
          profile: z.enum(EXECUTION_PROFILES).optional(),
          tradeScope: z.enum(TRADE_SCOPES).optional(),
          openOnly: z.boolean().optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      if (isMockMode()) seedExecutionDemoIfEmpty();
      return getLockedContracts(input ?? undefined);
    }),

  contractByRef: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string() }))
    .query(({ input }) => {
      syncAllLockedContracts();
      let c = getContractByRef(input.tradeRef.trim());
      if (!c) {
        syncAllLockedContracts();
        c = getContractByRef(input.tradeRef.trim());
      }
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found or trade not locked yet" });
      return {
        contract: c,
        inbound: getInboundReceipts(input.tradeRef),
        outbound: getOutboundDispatches(input.tradeRef),
        spot: getSpotEvent(input.tradeRef),
      };
    }),

  exportLockedCsv: roleProcedure([...execRoles, Role.TRADER])
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        profile: z.enum(EXECUTION_PROFILES).optional(),
      }),
    )
    .mutation(({ input }) => {
      const csv = exportLockedContractsCsv(input.from, input.to, input.profile);
      return {
        csv,
        filename: `locked-trades-${input.from.toISOString().slice(0, 10)}.csv`,
      };
    }),

  suggestInboundFifo: roleProcedure([...execRoles])
    .input(z.object({ qtyMt: z.number().positive(), sellerCode: z.string().optional() }))
    .query(({ input }) => suggestInboundFifo(input.qtyMt, input.sellerCode)),

  suggestSaleFifo: roleProcedure([...execRoles])
    .input(z.object({ qtyMt: z.number().positive() }))
    .query(({ input }) => suggestSaleFifo(input.qtyMt)),

  createInboundReceipt: roleProcedure([...execRoles])
    .input(
      z.object({
        kcsNo: z.string().min(1),
        receiveDate: z.coerce.date(),
        truckNo: z.string().min(1),
        biltyNo: z.string().min(1),
        trnNo: z.string().min(1),
        warehouseName: z.string().min(1),
        sellerName: z.string().min(1),
        tradeRef: z.string().min(1),
        billNo: z.string().optional(),
        bags: z.number().optional(),
        weightSpotKg: z.number().positive(),
        weightWarehouseKg: z.number().positive(),
        qualityReadings: qualitySchema,
        fifoOverrideReason: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      try {
        return createInboundReceipt({
          ...input,
          billNo: input.billNo ?? null,
          bags: input.bags ?? null,
          allocatedQtyMt: 0,
          fifoOverrideReason: input.fifoOverrideReason ?? null,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Failed",
        });
      }
    }),

  submitInboundForFinance: roleProcedure([...execRoles])
    .input(z.object({ receiptId: z.string() }))
    .mutation(({ input }) => {
      try {
        return submitInboundForFinance(input.receiptId);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  inboundReceipts: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string().optional() }).optional())
    .query(({ input }) => {
      if (isMockMode()) seedExecutionDemoIfEmpty();
      return getInboundReceipts(input?.tradeRef);
    }),

  createOutboundDispatch: roleProcedure([...execRoles])
    .input(
      z.object({
        dispatchDate: z.coerce.date(),
        liftedBy: z.string().min(1),
        buyerName: z.string().min(1),
        tradeRef: z.string().min(1),
        warehouseName: z.string().min(1),
        truckNo: z.string().min(1),
        dispatchWeightKg: z.number().positive(),
        invoiceWeightKg: z.number().positive(),
        fungusPct: z.number().min(0).default(0),
        fifoOverrideReason: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      try {
        return createOutboundDispatch({
          ...input,
          doRef: null,
          fifoOverrideReason: input.fifoOverrideReason ?? null,
        });
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  requestOutboundRelease: roleProcedure([...execRoles])
    .input(z.object({ dispatchId: z.string() }))
    .mutation(({ input }) => {
      try {
        return requestOutboundRelease(input.dispatchId);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  releaseOutbound: roleProcedure([...execRoles])
    .input(z.object({ dispatchId: z.string(), doRef: z.string().min(1) }))
    .mutation(({ input }) => {
      try {
        return releaseOutbound(input.dispatchId, input.doRef);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  outboundDispatches: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string().optional() }).optional())
    .query(({ input }) => {
      if (isMockMode()) seedExecutionDemoIfEmpty();
      return getOutboundDispatches(input?.tradeRef);
    }),

  spotEvent: roleProcedure([...execRoles])
    .input(z.object({ tradeRef: z.string() }))
    .query(({ input }) => getSpotEvent(input.tradeRef)),

  spotPipeline: roleProcedure([...execRoles])
    .input(z.object({ profile: z.enum(["PURCHASE_SPOT"]).optional() }).optional())
    .query(({ input }) => {
      if (isMockMode()) seedExecutionDemoIfEmpty();
      return listSpotPipeline(input?.profile ?? "PURCHASE_SPOT");
    }),

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
    .mutation(({ input }) => {
      try {
        return submitSpotForFinance(input.tradeRef);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  paymentRequests: roleProcedure([...execRoles, Role.FINANCE])
    .input(z.object({ status: z.string().optional() }).optional())
    .query(({ input }) => {
      if (isMockMode()) seedExecutionDemoIfEmpty();
      return getPaymentRequests(input ?? undefined);
    }),

  approvePayment: roleProcedure([...execRoles, Role.FINANCE])
    .input(z.object({ paymentId: z.string(), comment: z.string().optional() }))
    .mutation(({ input, ctx }) => {
      try {
        const approvedBy = (ctx as { user?: { name?: string } }).user?.name ?? "Execution";
        return approvePayment(input.paymentId, approvedBy, input.comment);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  rejectPayment: roleProcedure([...execRoles, Role.FINANCE])
    .input(z.object({ paymentId: z.string(), comment: z.string().optional() }))
    .mutation(({ input }) => {
      try {
        return rejectPayment(input.paymentId, input.comment);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),


  // ─── Pending Truck procedures ─────────────────────────────────────────────

  pendingTrucks: roleProcedure([...execRoles])
    .input(
      z.object({
        counterpartyName: z.string().optional(),
        warehouseName: z.string().optional(),
        movementType: z.enum(["INBOUND", "OUTBOUND"]).optional(),
        status: z.enum(["PENDING", "ASSIGNED", "PARTIAL"]).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }).optional(),
    )
    .query(({ input }) => {
      if (isMockMode()) seedExecutionDemoIfEmpty();
      syncExecutionFromDisk();
      return getPendingTrucks(input ?? undefined);
    }),

  createPendingTruck: roleProcedure([...execRoles])
    .input(
      z.object({
        counterpartyName: z.string().min(1),
        brokerName: z.string().optional(),
        movementType: z.enum(["INBOUND", "OUTBOUND"]),
        warehouseName: z.string().min(1),
        truckNo: z.string().min(1),
        driverName: z.string().optional(),
        driverPhone: z.string().optional(),
        builtyDetails: z.string().min(1),
        commodityCode: z.string().min(1),
        commodityName: z.string().min(1),
        recordedByName: z.string().min(1),
        weightKg: z.number().positive(),
        bags: z.number().optional(),
        remarks: z.string().optional(),
        gatepassNo: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      try {
        return createPendingTruck(input);
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
    .mutation(({ input }) => {
      try {
        return assignTruckToTrade(input.truckId, input.tradeRef, input.overrideWeightKg);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  assignTruckFifoAuto: roleProcedure([...execRoles])
    .input(z.object({ truckId: z.string() }))
    .mutation(({ input }) => {
      try {
        return assignTruckFifoAuto(input.truckId);
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
    .mutation(({ input }) => {
      const csv = exportMovementsCsv(input ?? undefined);
      const today = new Date().toISOString().slice(0, 10);
      return { csv, filename: `movements-${today}.csv` };
    }),
});

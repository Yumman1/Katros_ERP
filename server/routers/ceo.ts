import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ceoProcedure, router } from "@/server/trpc/trpc";
import {
  countPendingCeoApprovals,
  getChangeRequest,
  listChangeRequests,
  resolveChangeRequest,
} from "@/server/change-requests-store";
import { applyApprovedChangeRequest } from "@/server/change-request-apply";
import { recordTradeChangeResolved } from "@/server/trade-activity";
import {
  getInboundReceipts,
  getLockedContracts,
  getOutboundDispatches,
  getPendingTrucks,
} from "@/server/execution-store";
import { buildLocationCommodityInventory } from "@/lib/inventory-stock";
import {
  addCustomCommodity,
  deleteCustomCommodity,
  getCommodityById,
  getMergedCommodities,
  getMergedLocations,
} from "@/server/trader-master-data";
import { mockAllTraderTrades, mockTradeByRefGlobal } from "@/server/dummy-data";
import { commodityCreateInputSchema } from "@/lib/commodity-registration";
import {
  aggregateWarehouseStorageMetrics,
  computeWarehouseCosting,
  costingInputFromLocation,
} from "@/lib/warehouse-costing";

function actorName(user: { name?: string | null; email?: string | null }) {
  return user.name ?? user.email ?? "user";
}

export const ceoRouter = router({
  commodities: ceoProcedure().query(() => getMergedCommodities()),

  addCommodity: ceoProcedure()
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

  deleteCommodity: ceoProcedure()
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const commodity = await getCommodityById(input.id);
      if (!commodity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Commodity not found" });
      }
      const code = commodity.code.trim().toLowerCase();
      const tradesUsing = (await mockAllTraderTrades()).filter(
        (t) => t.commodity.code.trim().toLowerCase() === code,
      ).length;
      if (tradesUsing > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot delete ${commodity.code} — ${tradesUsing} trade${tradesUsing === 1 ? "" : "s"} reference it. Commodities with trade history cannot be removed.`,
        });
      }
      try {
        return await deleteCustomCommodity(input.id);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Could not delete commodity",
        });
      }
    }),

  pendingApprovals: ceoProcedure().query(() => countPendingCeoApprovals()),

  approvalQueue: ceoProcedure().query(() => listChangeRequests({ status: "PENDING_CEO" })),

  tradeByRefForPreview: ceoProcedure()
    .input(z.object({ tradeRef: z.string() }))
    .query(async ({ input }) => {
      return (await mockTradeByRefGlobal(input.tradeRef.trim())) ?? null;
    }),

  resolveApproval: ceoProcedure()
    .input(
      z.object({
        id: z.string(),
        decision: z.enum(["APPROVED", "REJECTED"]),
        note: z.string().trim().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const req = await getChangeRequest(input.id);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Change request not found" });
      if (req.status !== "PENDING_CEO") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This item is not awaiting CEO approval" });
      }

      let applied = false;
      if (input.decision === "APPROVED") {
        applied = await applyApprovedChangeRequest(req, actorName(ctx.session.user));
      }
      const resolved = await resolveChangeRequest(
        input.id,
        input.decision,
        actorName(ctx.session.user),
        input.note,
        applied,
      );
      if (req.entityType === "TRADE" && (input.decision === "REJECTED" || req.action === "DELETE")) {
        await recordTradeChangeResolved(resolved, input.decision, actorName(ctx.session.user));
      }
      return resolved;
    }),

  dashboardSummary: ceoProcedure().query(async () => {
    const contracts = await getLockedContracts({});
    const openLocked = contracts.filter((c) => c.contractStatus === "Open");
    const locations = await getMergedLocations();
    const storageSummaries = locations
      .map((loc) => computeWarehouseCosting(costingInputFromLocation(loc)))
      .filter((s): s is NonNullable<typeof s> => s != null);
    const storageNetwork = aggregateWarehouseStorageMetrics(storageSummaries);

    const [inbound, outbound, pendingTrucks] = await Promise.all([
      getInboundReceipts(),
      getOutboundDispatches(),
      getPendingTrucks({}),
    ]);
    const contractByRef = new Map(contracts.map((c) => [c.tradeRef, c]));
    const inventoryRows = buildLocationCommodityInventory({
      inbound,
      outbound,
      pendingTrucks,
      commodityForTradeRef: (ref) => {
        const c = contractByRef.get(ref);
        if (!c) return null;
        return { code: c.commodityCode, name: c.commodityName, unit: c.quantityUnit };
      },
    });

    const totalNetMt = inventoryRows.reduce((s, r) => s + r.netQty, 0);
    const totalUnallocatedMt = inventoryRows.reduce((s, r) => s + r.unallocatedQty, 0);
    const avgFulfillment =
      openLocked.length > 0
        ? openLocked.reduce((s, c) => {
            const pct = c.contractualQtyMt > 0 ? c.receivedQtyMt / c.contractualQtyMt : 0;
            return s + pct;
          }, 0) / openLocked.length
        : 0;

    return {
      warehouseCount: locations.length,
      lockedTradeCount: contracts.length,
      openLockedCount: openLocked.length,
      pendingApprovals: await countPendingCeoApprovals(),
      totalNetMt,
      totalUnallocatedMt,
      avgFulfillmentPct: avgFulfillment,
      storageNetwork,
      inventoryRows,
    };
  }),
});

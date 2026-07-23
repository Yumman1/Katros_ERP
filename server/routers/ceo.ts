import { z } from "zod";
import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
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
  ceoResolveClearWithoutPayment,
  getCeoClearApprovals,
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


  // ─── User management (CEO is the top authority) ───────────────────────────

  users: ceoProcedure().query(async () => {
    const rows = await prisma.user.findMany({
      orderBy: [{ disabled: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isHead: true,
        disabled: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
    return rows;
  }),

  /** Users active in the last 5 minutes (presence heartbeat). */
  activeUsers: ceoProcedure().query(async () => {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const rows = await prisma.user.findMany({
      where: { disabled: false, lastSeenAt: { gte: cutoff } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, email: true, name: true, role: true, lastSeenAt: true },
    });
    return { count: rows.length, users: rows };
  }),

  createUser: ceoProcedure()
    .input(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        name: z.string().trim().min(1, "Name is required"),
        password: z.string().min(8, "Password must be at least 8 characters"),
        role: z.enum(["CEO", "TRADER", "EXECUTION", "FINANCE", "RISK_MANAGER", "READ_ONLY"]),
        isHead: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await prisma.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash,
            role: input.role,
            isHead: input.isHead ?? false,
          },
          select: { id: true, email: true, name: true, role: true, isHead: true },
        });
        return user;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new TRPCError({ code: "CONFLICT", message: "A user with this email already exists" });
        }
        throw e;
      }
    }),

  updateUser: ceoProcedure()
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1).optional(),
        role: z.enum(["CEO", "TRADER", "EXECUTION", "FINANCE", "RISK_MANAGER", "READ_ONLY"]).optional(),
        isHead: z.boolean().optional(),
        disabled: z.boolean().optional(),
        /** Set to reset the user's password. */
        password: z.string().min(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const self = ctx.session.user.id === input.id;
      if (self && (input.disabled === true || (input.role && input.role !== "CEO"))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot disable or demote your own account",
        });
      }
      const data: Prisma.UserUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.role !== undefined) data.role = input.role;
      if (input.isHead !== undefined) data.isHead = input.isHead;
      if (input.disabled !== undefined) data.disabled = input.disabled;
      if (input.password) data.passwordHash = await bcrypt.hash(input.password, 12);
      try {
        return await prisma.user.update({
          where: { id: input.id },
          data,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isHead: true,
            disabled: true,
            lastSeenAt: true,
            createdAt: true,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
          throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        }
        throw e;
      }
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

  // ─── Clear-without-payment approvals (trader approved, CEO decides) ────────

  clearWithoutPaymentApprovals: ceoProcedure().query(() => getCeoClearApprovals()),

  clearWithoutPaymentCount: ceoProcedure().query(
    async () => (await getCeoClearApprovals()).length,
  ),

  /** APPROVE → truck cleared unpaid + slips issued; REJECT requires a reason. */
  resolveClearWithoutPayment: ceoProcedure()
    .input(
      z.object({
        truckId: z.string(),
        decision: z.enum(["APPROVE", "REJECT"]),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ceoResolveClearWithoutPayment(
          input.truckId,
          ctx.session.user.name ?? ctx.session.user.email ?? "CEO",
          input.decision,
          input.reason,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Failed",
        });
      }
    }),
});

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, headProcedure, router } from "@/server/trpc/trpc";
import {
  canActOnDepartment,
  CHANGE_REQUEST_ACTIONS,
  DEPARTMENTS,
  departmentForRole,
  requiresCeoApproval,
  type Department,
} from "@/lib/departments";
import {
  createChangeRequest,
  getChangeRequest,
  listChangeRequests,
  resolveChangeRequest,
  advanceChangeRequestToCeo,
  hasOpenChangeRequest,
} from "@/server/change-requests-store";
import { getContractByRef } from "@/server/execution-store";
import { applyApprovedChangeRequest } from "@/server/change-request-apply";
import { markOpenTradeWarehousePendingApproval } from "@/server/open-trades";
import { recordTradeChangeRequested, recordTradeChangeResolved } from "@/server/trade-activity";
import { canonicalTraderName, traderNamesMatch } from "@/lib/trader-identity";
import { commodityCreateInputSchema, commodityEntityRef } from "@/lib/commodity-registration";
import { getMergedCommodities } from "@/server/trader-master-data";
import { mockTradeByRefGlobal, syncBookedTradesFromDisk } from "@/server/dummy-data";
import { TradeStatus } from "@prisma/client";

function actorName(user: { name?: string | null; email?: string | null }) {
  return user.name ?? user.email ?? "user";
}

export const teamRouter = router({
  /** Current user's department context. */
  me: protectedProcedure.query(({ ctx }) => {
    const { role, isHead } = ctx.session.user;
    return {
      role,
      isHead,
      department: departmentForRole(role),
    };
  }),

  /** A team member requests that a head edit or delete an entry, with comments. */
  submitChangeRequest: protectedProcedure
    .input(
      z.object({
        entityType: z.string().min(1),
        entityRef: z.string().min(1),
        entityLabel: z.string().min(1),
        action: z.enum(CHANGE_REQUEST_ACTIONS),
        comment: z.string().trim().min(1, "Please add a comment explaining this request"),
        department: z.enum(DEPARTMENTS).optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const role = ctx.session.user.role;
      const department = input.department ?? departmentForRole(role);
      if (!department) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Your role is not part of a department that raises change requests",
        });
      }

      if (input.action === "CLOSE") {
        if (input.entityType !== "TRADE") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "CLOSE is only supported for trades" });
        }
        const contract = getContractByRef(input.entityRef.trim());
        if (!contract) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Locked contract not found" });
        }
        if (contract.contractStatus !== "Open") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only open locked trades can be closed" });
        }
        if (
          department === "TRADING" &&
          role !== "ADMIN" &&
          !traderNamesMatch(
            contract.traderName,
            canonicalTraderName(ctx.session.user.name ?? ctx.session.user.email ?? ""),
          )
        ) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only close your own trades" });
        }
        if (hasOpenChangeRequest({ entityRef: input.entityRef, entityType: "TRADE", action: "CLOSE" })) {
          throw new TRPCError({ code: "CONFLICT", message: "A close request is already pending approval" });
        }
      }

      if (input.action === "CREATE" && input.entityType === "COMMODITY") {
        const parsed = commodityCreateInputSchema.safeParse(input.payload);
        if (!parsed.success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid commodity details" });
        }
        const code = parsed.data.code.trim().toUpperCase();
        if (getMergedCommodities().some((c) => c.code.toUpperCase() === code)) {
          throw new TRPCError({ code: "CONFLICT", message: `Commodity code ${code} already exists` });
        }
        if (
          hasOpenChangeRequest({
            entityRef: commodityEntityRef(code),
            entityType: "COMMODITY",
            action: "CREATE",
          })
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A registration request for this commodity is already pending CEO approval",
          });
        }
      }

      if (
        department === "TRADING" &&
        input.entityType === "TRADE" &&
        (input.action === "EDIT" || input.action === "DELETE")
      ) {
        syncBookedTradesFromDisk();
        const trade = mockTradeByRefGlobal(input.entityRef.trim());
        if (!trade) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
        }
        if (
          role !== "ADMIN" &&
          !traderNamesMatch(
            trade.traderName,
            canonicalTraderName(ctx.session.user.name ?? ctx.session.user.email ?? ""),
          )
        ) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only change your own trades" });
        }
        if (trade.tradeStatus !== TradeStatus.PENDING) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              trade.tradeStatus === TradeStatus.LOCKED || trade.tradeStatus === TradeStatus.CONFIRMED
                ? "Locked trades cannot be edited — price and quantity are fixed for inventory and utilization"
                : "This trade cannot be edited or deleted",
          });
        }
        if (!trade.submittedToExecution && trade.tradeStatus === TradeStatus.PENDING) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Draft trades can be edited directly from My Trades — CEO approval is not required until you submit to execution",
          });
        }
        if (input.action === "EDIT" && (!input.payload || !Object.keys(input.payload).length)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Edit request must include proposed changes" });
        }
        if (
          hasOpenChangeRequest({
            entityRef: input.entityRef,
            entityType: "TRADE",
            action: input.action,
          })
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A ${input.action.toLowerCase()} request for this trade is already pending approval`,
          });
        }
      }

      let initialStatus: "PENDING" | "PENDING_CEO" | undefined;
      if (requiresCeoApproval(input.entityType, input.action, department)) {
        if (input.action === "CLOSE") {
          initialStatus = "PENDING_CEO";
        } else if (input.action === "CREATE" && input.entityType === "COMMODITY") {
          initialStatus = "PENDING_CEO";
        } else if (
          input.action === "CREATE" &&
          input.entityType === "WAREHOUSE" &&
          canActOnDepartment(role, ctx.session.user.isHead, "EXECUTION")
        ) {
          initialStatus = "PENDING_CEO";
        } else if (
          department === "TRADING" &&
          input.entityType === "TRADE" &&
          (input.action === "EDIT" || input.action === "DELETE")
        ) {
          initialStatus = "PENDING_CEO";
        }
      }

      const req = createChangeRequest({
        department,
        entityType: input.entityType,
        entityRef: input.entityRef,
        entityLabel: input.entityLabel,
        action: input.action,
        comment: input.comment,
        requestedById: ctx.session.user.id,
        requestedByName: actorName(ctx.session.user),
        payload: input.payload ?? null,
        status: initialStatus,
      });
      if (
        department === "EXECUTION" &&
        input.entityType === "OPEN_TRADE_WAREHOUSE" &&
        input.action === "EDIT"
      ) {
        try {
          markOpenTradeWarehousePendingApproval(input.entityRef);
        } catch {
          // Best-effort flag only.
        }
      }
      if (input.entityType === "TRADE" && (input.action === "EDIT" || input.action === "DELETE")) {
        recordTradeChangeRequested(req);
      }
      return req;
    }),

  /** Requests the current user submitted. */
  myChangeRequests: protectedProcedure.query(({ ctx }) =>
    listChangeRequests({ requestedById: ctx.session.user.id }),
  ),

  /** Department queue — heads only. */
  changeRequests: headProcedure()
    .input(z.object({ department: z.enum(DEPARTMENTS) }))
    .query(({ ctx, input }) => {
      const { role, isHead } = ctx.session.user;
      if (!canActOnDepartment(role, isHead, input.department)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not the head of this department" });
      }
      return listChangeRequests({ department: input.department });
    }),

  /** Head approves (auto-applies deletes) or rejects a request. */
  resolveChangeRequest: headProcedure()
    .input(
      z.object({
        id: z.string(),
        decision: z.enum(["APPROVED", "REJECTED"]),
        note: z.string().trim().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const req = getChangeRequest(input.id);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Change request not found" });
      const { role, isHead } = ctx.session.user;
      if (!canActOnDepartment(role, isHead, req.department)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not the head of this department" });
      }

      let applied = false;
      if (input.decision === "APPROVED") {
        if (
          req.status === "PENDING" &&
          req.action === "CREATE" &&
          req.entityType === "WAREHOUSE"
        ) {
          return advanceChangeRequestToCeo(input.id, actorName(ctx.session.user), input.note);
        }
        applied = applyApprovedChangeRequest(req, actorName(ctx.session.user));
      }
      const resolved = resolveChangeRequest(
        input.id,
        input.decision,
        actorName(ctx.session.user),
        input.note,
        applied,
      );
      if (req.entityType === "TRADE" && (input.decision === "REJECTED" || req.action === "DELETE")) {
        recordTradeChangeResolved(resolved, input.decision, actorName(ctx.session.user));
      }
      return resolved;
    }),

  pendingApprovals: headProcedure()
    .input(z.object({ department: z.enum(DEPARTMENTS) }))
    .query(({ ctx, input }) => {
      const { role, isHead } = ctx.session.user;
      if (!canActOnDepartment(role, isHead, input.department)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not the head of this department" });
      }
      return listChangeRequests({ department: input.department, status: "PENDING" }).length;
    }),
});

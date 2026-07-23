import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { headProcedure, roleProcedure, router } from "@/server/trpc/trpc";
import {
  approvePayment,
  deletePaymentRequest,
  listPaymentRequests,
  rejectPayment,
  settleSaleTruck,
} from "@/server/execution-store";
import { getCounterpartyLedgers } from "@/server/finance/ledger";
import { approveVoucher, listVouchers, rejectVoucher } from "@/server/finance/vouchers";

export const financeRouter = router({
  pendingPayments: roleProcedure(["FINANCE", "ADMIN"]).query(async () =>
    (await listPaymentRequests("PENDING")).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    ),
  ),

  allPayments: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional() }).optional())
    .query(({ input }) => listPaymentRequests(input?.status)),

  approvePayment: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ paymentId: z.string(), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await approvePayment(
          input.paymentId,
          ctx.session.user.name ?? ctx.session.user.email ?? "finance",
          input.comment,
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  rejectPayment: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ paymentId: z.string(), comment: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        return await rejectPayment(input.paymentId, input.comment);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  // Head-of-finance direct deletion of an erroneous payment request.
  deletePayment: headProcedure("FINANCE")
    .input(z.object({ paymentId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        return await deletePaymentRequest(input.paymentId);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  // ─── Counterparty ledgers ───────────────────────────────────────────────────

  /** SELL-side counterparty ledgers with totals + aging. */
  counterpartyLedgers: roleProcedure(["FINANCE", "ADMIN"]).query(() => getCounterpartyLedgers()),

  // ─── Payment vouchers (approval makes the money part of the ledger) ────────

  vouchers: roleProcedure(["FINANCE", "ADMIN"])
    .input(
      z
        .object({ status: z.enum(["PENDING_FINANCE", "APPROVED", "REJECTED"]).optional() })
        .optional(),
    )
    .query(({ input }) => listVouchers(input ?? undefined)),

  pendingVouchersCount: roleProcedure(["FINANCE", "ADMIN"]).query(
    async () => (await listVouchers({ status: "PENDING_FINANCE" })).length,
  ),

  approveVoucher: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ voucherId: z.string(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await approveVoucher(
          input.voucherId,
          ctx.session.user.name ?? ctx.session.user.email ?? "finance",
          input.note,
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  rejectVoucher: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ voucherId: z.string(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await rejectVoucher(
          input.voucherId,
          ctx.session.user.name ?? ctx.session.user.email ?? "finance",
          input.note,
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  // ─── Settle against old dues (released-on-credit trucks) ───────────────────

  /**
   * Apply the buyer's available ledger credit against a specific
   * released-unpaid truck — stops its aging and clears the trader reminder.
   */
  settleSaleTruck: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ truckId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await settleSaleTruck(
          input.truckId,
          ctx.session.user.name ?? ctx.session.user.email ?? "finance",
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),
});

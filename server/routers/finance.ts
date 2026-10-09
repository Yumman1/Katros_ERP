import { purchaseInvoiceDocument } from "@/server/finance/purchase-invoice";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { canActOnDepartment } from "@/lib/departments";
import { headProcedure, roleProcedure, router } from "@/server/trpc/trpc";
import { countPendingChangeRequests } from "@/server/change-requests-store";
import {
  approvePayment,
  deletePaymentRequest,
  listPaymentRequests,
  rejectPayment,
  settleSaleTruck,
} from "@/server/execution-store";
import { getCounterpartyLedgers } from "@/server/finance/ledger";
import { approveVoucher, listVouchers, rejectVoucher } from "@/server/finance/vouchers";
import { approveDoFinance, getDoFinanceApprovals } from "@/server/execution/sale-workflow";

export const financeRouter = router({
  purchaseInvoiceDocument:roleProcedure(["FINANCE","ADMIN"]).input(z.object({requestRef:z.string()})).query(({input})=>purchaseInvoiceDocument(input.requestRef)),
  completedPurchasePayments:roleProcedure(["FINANCE","ADMIN"]).query(async()=>(await listPaymentRequests("APPROVED")).filter(p=>p.sourceType==="INBOUND").slice(0,100)),
  pendingPayments: roleProcedure(["FINANCE", "ADMIN"]).query(async () =>
    (await listPaymentRequests("PENDING")).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    ),
  ),


  approvePayment: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ paymentId: z.string(), comment: z.string().optional(), paymentReference:z.string().trim().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await approvePayment(
          input.paymentId,
          ctx.session.user.name ?? ctx.session.user.email ?? "finance",
          input.comment,
          input.paymentReference,
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  rejectPayment: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ paymentId: z.string(), comment: z.string().trim().min(1, "A rejection reason is required") }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await rejectPayment(input.paymentId, input.comment, {
          name: ctx.session.user.name ?? ctx.session.user.email ?? "finance",
          role: ctx.session.user.role,
        });
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
    .query(({ input }) => listVouchers({...input,financeOnly:true})),

  pendingVouchersCount: roleProcedure(["FINANCE", "ADMIN"]).query(
    async () => (await listVouchers({ status: "PENDING_FINANCE",financeOnly:true })).length,
  ),

  /** Sidebar + nav badge counts for every finance approval queue. */
  approvalBadges: roleProcedure(["FINANCE", "ADMIN"]).query(async ({ ctx }) => {
    const u = ctx.session.user;
    const isFinanceHead = canActOnDepartment(u.role, u.isHead ?? false, "FINANCE");
    const [payments, vouchers, doApprovals, changeRequests] = await Promise.all([
      listPaymentRequests("PENDING"),
      listVouchers({ status: "PENDING_FINANCE",financeOnly:true }),
      getDoFinanceApprovals(),
      isFinanceHead ? countPendingChangeRequests("FINANCE") : Promise.resolve(0),
    ]);
    const counts = {
      payments: payments.length,
      vouchers: vouchers.length,
      doApprovals: doApprovals.length,
      changeRequests,
    };
    return {
      ...counts,
      total: counts.payments + counts.vouchers + counts.doApprovals + counts.changeRequests,
    };
  }),

  approveVoucher: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ voucherId: z.string(), note: z.string().optional(), paymentReference: z.string().trim().optional(), paymentMethod: z.enum(["Bank transfer","Cheque","Cash","Other"]).optional(), bankName: z.string().trim().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await approveVoucher(
          input.voucherId,
          ctx.session.user.name ?? ctx.session.user.email ?? "finance",
          input.note,
          input.paymentReference,
          {method: input.paymentMethod, bankName: input.bankName},
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

  // ─── Delivery order approvals (after execution head) ─────────────────────

  doApprovals: roleProcedure(["FINANCE", "ADMIN"]).query(() => getDoFinanceApprovals()),

  approveDo: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ truckId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await approveDoFinance(
          input.truckId,
          ctx.session.user.name ?? ctx.session.user.email ?? "finance",
        );
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),
});

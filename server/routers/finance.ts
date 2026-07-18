import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { headProcedure, roleProcedure, router } from "@/server/trpc/trpc";
import {
  approvePayment,
  deletePaymentRequest,
  listPaymentRequests,
  rejectPayment,
} from "@/server/execution-store";

export const financeRouter = router({
  pendingPayments: roleProcedure(["FINANCE", "ADMIN"]).query(() =>
    listPaymentRequests("PENDING").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  ),

  allPayments: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional() }).optional())
    .query(({ input }) => listPaymentRequests(input?.status)),

  approvePayment: roleProcedure(["FINANCE", "ADMIN"])
    .input(z.object({ paymentId: z.string(), comment: z.string().optional() }))
    .mutation(({ ctx, input }) => {
      try {
        return approvePayment(
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
    .mutation(({ input }) => {
      try {
        return rejectPayment(input.paymentId, input.comment);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  // Head-of-finance direct deletion of an erroneous payment request.
  deletePayment: headProcedure("FINANCE")
    .input(z.object({ paymentId: z.string() }))
    .mutation(({ input }) => {
      try {
        return deletePaymentRequest(input.paymentId);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),
});

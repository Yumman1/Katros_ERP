import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { InvoiceStatus } from "@prisma/client";
import { startOfMonth, endOfMonth } from "date-fns";
import { isMockMode } from "@/server/mock-mode";
import { mockCashflowList, mockUpcomingInvoices } from "@/server/dummy-data";

export const cashflowRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        month: z.coerce.date().optional(),
        projectedOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (isMockMode()) return mockCashflowList(input.projectedOnly ?? undefined);
      const m = input.month ?? new Date();
      const entries = await ctx.prisma.cashFlowEntry.findMany({
        where: {
          valueDate: { gte: startOfMonth(m), lte: endOfMonth(m) },
          ...(input.projectedOnly != null
            ? { isProjected: input.projectedOnly }
            : {}),
        },
        orderBy: { valueDate: "asc" },
        take: 500,
      });
      let bal = 0;
      const rows = entries.map((e) => {
        bal += Number(e.amount);
        return {
          id: e.id,
          valueDate: e.valueDate.toISOString(),
          entryDate: e.entryDate.toISOString(),
          type: e.entryType,
          description: e.description,
          amount: Number(e.amount),
          currency: e.currency,
          running: bal,
          isProjected: e.isProjected,
          isPaid: e.isPaid,
          tradeRef: e.tradeRef,
        };
      });
      const receipts = entries
        .filter((e) => Number(e.amount) > 0)
        .reduce((a, e) => a + Number(e.amount), 0);
      const payments = entries
        .filter((e) => Number(e.amount) < 0)
        .reduce((a, e) => a + Number(e.amount), 0);
      return {
        rows,
        summary: {
          receipts,
          payments,
          net: receipts + payments,
          opening: 0,
          closing: bal,
        },
      };
    }),

  upcoming: protectedProcedure.query(async ({ ctx }) => {
    if (isMockMode()) return mockUpcomingInvoices();
    const now = new Date();
    return ctx.prisma.invoice.findMany({
      where: { dueDate: { gte: now }, status: { not: InvoiceStatus.PAID } },
      orderBy: { dueDate: "asc" },
      take: 20,
      include: { counterparty: true, trade: true },
    });
  }),
});

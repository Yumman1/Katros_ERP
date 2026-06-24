import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import type { Reconciliation } from "@prisma/client";
import { ReconType, ReconStatus } from "@prisma/client";
import { autoReconcileTradeInvoice } from "@/lib/calculations/reconciliation";
import { isMockMode } from "@/server/mock-mode";
import {
  mockAutoReconcile,
  mockReconciliationList,
  mockReconciliationSummary,
} from "@/server/dummy-data";

export const reconciliationRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        type: z.nativeEnum(ReconType).optional(),
        status: z.nativeEnum(ReconStatus).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      if (isMockMode()) {
        return mockReconciliationList({ type: input.type, status: input.status }) as unknown as Reconciliation[];
      }
      return ctx.prisma.reconciliation.findMany({
        where: {
          ...(input.type ? { reconType: input.type } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: { reconDate: "desc" },
        take: 300,
      });
    }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    if (isMockMode()) return mockReconciliationSummary();
    const rows = await ctx.prisma.reconciliation.groupBy({
      by: ["status"],
      _count: { id: true },
    });
    const map = Object.fromEntries(rows.map((r) => [r.status, r._count.id])) as Record<
      string,
      number
    >;
    return {
      matched: map.MATCHED ?? 0,
      break: map.BREAK ?? 0,
      pending: map.PENDING_REVIEW ?? 0,
      resolved: map.RESOLVED ?? 0,
      total: rows.reduce((a, r) => a + r._count.id, 0),
    };
  }),

  runAutoTradeInvoice: protectedProcedure.mutation(async ({ ctx }) => {
    if (isMockMode()) return mockAutoReconcile();
    const invoices = await ctx.prisma.invoice.findMany({
      include: { trade: true },
      take: 200,
    });
    let matched = 0;
    let breaks = 0;
    for (const inv of invoices) {
      const t = inv.trade;
      const gross = Number(t.quantity) * Number(t.price);
      const res = autoReconcileTradeInvoice({
        tradeQuantity: Number(t.quantity),
        tradeGross: gross,
        invoiceQuantity: inv.quantity ? Number(inv.quantity) : null,
        invoiceAmount: Number(inv.amount),
      });
      if (res.status === "MATCHED") matched++;
      else breaks++;
    }
    return { matched, breaks, message: "Auto-match scan complete (in-memory demo)" };
  }),
});

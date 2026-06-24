import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { isMockMode } from "@/server/mock-mode";
import { mockTraceById, mockTraceSearch } from "@/server/dummy-data";

type TraceWithRelations = Prisma.TraceabilityRecordGetPayload<{
  include: {
    chainOfCustody: true;
    commodity: true;
    tradeLinks: { include: { trade: true } };
  };
}>;

export const traceabilityRouter = router({
  search: protectedProcedure
    .input(
      z.object({
        q: z.string().optional(),
        commodityId: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      if (isMockMode()) {
        return mockTraceSearch(input.q, input.commodityId) as unknown as Prisma.TraceabilityRecordGetPayload<{
          include: { commodity: true };
        }>[];
      }
      return ctx.prisma.traceabilityRecord.findMany({
        where: {
          ...(input.q ? { batchRef: { contains: input.q, mode: "insensitive" } } : {}),
          ...(input.commodityId ? { commodityId: input.commodityId } : {}),
        },
        include: { commodity: true },
        orderBy: { harvestDate: "desc" },
        take: 100,
      });
    }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    if (isMockMode()) return mockTraceById(input.id) as unknown as TraceWithRelations | null;
    return ctx.prisma.traceabilityRecord.findUnique({
      where: { id: input.id },
      include: {
        chainOfCustody: { orderBy: { eventDate: "asc" } },
        commodity: true,
        tradeLinks: { include: { trade: true } },
      },
    });
  }),
});

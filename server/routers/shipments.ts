import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { isMockMode } from "@/server/mock-mode";
import { mockShipmentSummary, mockShipments, type ShipmentStatus } from "@/server/dummy-data";

export type ShipmentListRow = ReturnType<typeof mockShipments>[number];

const statusSchema = z.enum([
  "PLANNED",
  "LOADING",
  "IN_TRANSIT",
  "AT_PORT",
  "DELIVERED",
  "DELAYED",
  "CANCELLED",
]);

export const shipmentsRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    if (isMockMode()) return mockShipmentSummary();
    const shipments = await ctx.prisma.shipment.findMany({ take: 500 });
    return {
      total: shipments.length,
      inTransit: shipments.length,
      delayed: 0,
      delivered30d: 0,
      totalQtyInPipeline: shipments.reduce((a, s) => a + Number(s.quantity), 0),
    };
  }),

  list: protectedProcedure
    .input(
      z
        .object({
          status: statusSchema.optional(),
          locationId: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (isMockMode()) {
        return mockShipments({
          status: input?.status as ShipmentStatus | undefined,
          locationId: input?.locationId,
        }) as unknown as Awaited<ReturnType<typeof ctx.prisma.shipment.findMany>>;
      }
      return ctx.prisma.shipment.findMany({
        where: {
          locationId: input?.locationId,
        },
        include: {
          trade: { include: { commodity: true, counterparty: true } },
          location: true,
        },
        orderBy: { shippedAt: "desc" },
        take: 200,
      });
    }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    if (isMockMode()) {
      return mockShipments().find((s) => s.id === input.id) ?? null;
    }
    return null;
  }),
});

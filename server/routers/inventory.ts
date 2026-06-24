import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { InventoryStatus } from "@prisma/client";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { isMockMode } from "@/server/mock-mode";
import {
  mockInventoryAging,
  mockInventoryList,
  mockInventoryMovements,
  mockInventorySummary,
} from "@/server/dummy-data";

type InventoryWithRelations = Prisma.InventoryGetPayload<{
  include: { commodity: true; location: true };
}>;

type MovementWithRelations = Prisma.InventoryMovementGetPayload<{
  include: { inventory: { include: { commodity: true; location: true } } };
}>;

export const inventoryRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    if (isMockMode()) return mockInventorySummary();
    const inv = await ctx.prisma.inventory.findMany({
      include: { commodity: true, location: true },
      take: 500,
    });
    const byCommodity = new Map<
      string,
      { code: string; onHand: number; reserved: number; transit: number; value: number }
    >();
    for (const row of inv) {
      const cur = byCommodity.get(row.commodityId) ?? {
        code: row.commodity.code,
        onHand: 0,
        reserved: 0,
        transit: 0,
        value: 0,
      };
      cur.onHand += Number(row.quantity);
      cur.reserved += Number(row.reservedQty);
      cur.transit += Number(row.inTransitQty);
      cur.value += Number(row.totalValue);
      byCommodity.set(row.commodityId, cur);
    }
    return Array.from(byCommodity.values());
  }),

  list: protectedProcedure
    .input(
      z
        .object({
          locationId: z.string().optional(),
          commodityId: z.string().optional(),
          status: z.nativeEnum(InventoryStatus).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      if (isMockMode()) {
        return mockInventoryList(input?.locationId, input?.commodityId, input?.status) as unknown as InventoryWithRelations[];
      }
      return ctx.prisma.inventory.findMany({
        where: {
          locationId: input?.locationId,
          commodityId: input?.commodityId,
          status: input?.status,
        },
        include: { commodity: true, location: true },
        orderBy: { updatedAt: "desc" },
        take: 400,
      });
    }),

  aging: protectedProcedure.query(({ ctx }) => {
    if (isMockMode()) return mockInventoryAging();
    const inv = ctx.prisma.inventory.findMany({
      include: { commodity: true, location: true },
      take: 400,
    });
    return inv.then((lots) =>
      lots.map((lot) => {
        const arrival = lot.arrivalDate ?? new Date();
        const daysInStorage = Math.floor((Date.now() - arrival.getTime()) / 86400000);
        const available = Number(lot.quantity) - Number(lot.reservedQty);
        return {
          id: lot.id,
          warehouseRef: lot.warehouseRef,
          commodity: lot.commodity.code,
          location: lot.location.name,
          quantity: Number(lot.quantity),
          available,
          reserved: Number(lot.reservedQty),
          daysInStorage,
          agingBucket:
            daysInStorage <= 30 ? "0-30d" : daysInStorage <= 60 ? "31-60d" : daysInStorage <= 90 ? "61-90d" : "90d+",
          expiryDate: lot.expiryDate,
          qualityGrade: lot.qualityGrade,
        };
      }),
    );
  }),

  movements: protectedProcedure
    .input(z.object({ inventoryId: z.string().optional() }).optional())
    .query(({ ctx, input }) => {
      if (isMockMode()) {
        return mockInventoryMovements(input?.inventoryId) as unknown as MovementWithRelations[];
      }
      return ctx.prisma.inventoryMovement.findMany({
        where: input?.inventoryId ? { inventoryId: input.inventoryId } : undefined,
        include: { inventory: { include: { commodity: true, location: true } } },
        orderBy: { movementDate: "desc" },
        take: 400,
      });
    }),
});

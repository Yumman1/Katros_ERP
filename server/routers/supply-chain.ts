import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { isMockMode } from "@/server/mock-mode";
import {
  mockCounterpartiesScm,
  mockLocationsDetail,
  mockPositionVsInventory,
  mockSupplyChainOverview,
} from "@/server/dummy-data";

export const supplyChainRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    if (isMockMode()) return mockSupplyChainOverview();
    const inv = await ctx.prisma.inventory.findMany({ include: { commodity: true } });
    const totalOnHand = inv.reduce((a, x) => a + Number(x.quantity), 0);
    const totalReserved = inv.reduce((a, x) => a + Number(x.reservedQty), 0);
    const totalTransit = inv.reduce((a, x) => a + Number(x.inTransitQty), 0);
    const totalValue = inv.reduce((a, x) => a + Number(x.totalValue), 0);
    const base = mockSupplyChainOverview();
    return {
      ...base,
      kpis: {
        ...base.kpis,
        totalOnHand,
        totalReserved,
        totalTransit,
        totalValue,
        availableToSell: totalOnHand - totalReserved,
      },
    };
  }),

  locations: protectedProcedure.query(async ({ ctx }) => {
    if (isMockMode()) return mockLocationsDetail();
    const locations = await ctx.prisma.location.findMany({ orderBy: { name: "asc" } });
    const inv = await ctx.prisma.inventory.findMany({
      include: { commodity: true },
    });
    return locations.map((loc) => {
      const lots = inv.filter((i) => i.locationId === loc.id);
      const onHand = lots.reduce((a, l) => a + Number(l.quantity), 0);
      const reserved = lots.reduce((a, l) => a + Number(l.reservedQty), 0);
      const inTransit = lots.reduce((a, l) => a + Number(l.inTransitQty), 0);
      const value = lots.reduce((a, l) => a + Number(l.totalValue), 0);
      const capacityMt = 20_000;
      return {
        id: loc.id,
        name: loc.name,
        type: loc.type,
        country: loc.country,
        region: loc.country,
        capacityMt,
        onHand,
        reserved,
        inTransit,
        value,
        utilization: onHand / capacityMt,
        lotCount: lots.length,
        commodities: [...new Set(lots.map((l) => l.commodity.code))],
        activeShipments: 0,
        availableCapacity: Math.max(0, capacityMt - onHand),
      };
    });
  }),

  counterparties: protectedProcedure
    .input(z.object({ type: z.enum(["BUYER", "SELLER", "ALL"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (isMockMode()) {
        const all = mockCounterpartiesScm();
        if (!input?.type || input.type === "ALL") return all;
        return all.filter((c) => c.type === input.type);
      }
      const cps = await ctx.prisma.counterparty.findMany({ orderBy: { name: "asc" } });
      return cps.map((cp) => ({
        id: cp.id,
        name: cp.name,
        code: cp.code,
        type: cp.type,
        country: cp.country,
        creditLimit: Number(cp.creditLimit ?? 0),
        activeTrades: 0,
        openShipments: 0,
        onTimeDeliveryPct: 0.9,
        avgLeadTimeDays: 14,
        commoditiesSupplied: [] as string[],
        lastDelivery: new Date(),
      }));
    }),

  positionVsInventory: protectedProcedure.query(async ({ ctx }) => {
    if (isMockMode()) return mockPositionVsInventory();
    const positions = await ctx.prisma.position.findMany({
      include: { commodity: true },
      orderBy: { positionDate: "desc" },
      take: 20,
    });
    const inv = await ctx.prisma.inventory.findMany({ include: { commodity: true } });
    const byCommodity = new Map<string, { net: number; physical: number; reserved: number }>();
    for (const p of positions) {
      const cur = byCommodity.get(p.commodityId) ?? { net: 0, physical: 0, reserved: 0 };
      cur.net = Number(p.netQty);
      byCommodity.set(p.commodityId, cur);
    }
    for (const row of inv) {
      const cur = byCommodity.get(row.commodityId) ?? { net: 0, physical: 0, reserved: 0 };
      cur.physical += Number(row.quantity);
      cur.reserved += Number(row.reservedQty);
      byCommodity.set(row.commodityId, cur);
    }
    return positions.map((p) => {
      const data = byCommodity.get(p.commodityId)!;
      const variance = data.net - (data.physical - data.reserved);
      return {
        commodity: p.commodity.name,
        code: p.commodity.code,
        positionNet: data.net,
        physicalOnHand: data.physical,
        physicalAvailable: data.physical - data.reserved,
        variance,
        variancePct: data.physical > 0 ? variance / data.physical : 0,
        status: Math.abs(variance) < 1 ? ("MATCHED" as const) : ("BREAK" as const),
      };
    });
  }),
});

import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { buildCommercialReport, type ReportMovement, type ReportFilters } from "@/lib/reports/commercial";
import { DEFAULT_KG_PER_UNIT } from "@/lib/price-units";
import { canonicalTraderName } from "@/lib/trader-identity";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Invalid calendar date");
export const commercialReportInput = z.object({
  from: day, to: day, basis: z.enum(["delivered", "booked"]).default("delivered"),
  groupBy: z.enum(["week", "month", "year"]).default("month"),
  commodityId: z.string().optional(), counterpartyId: z.string().optional(), warehouse: z.string().optional(),
}).refine((v) => v.from <= v.to, { message: "Start date must be on or before end date", path: ["to"] });

const tradeInclude = {
  commodity: { select: { id: true, code: true, name: true, unit: true, canonicalKgPerUnit: true } },
  counterparty: { select: { id: true, name: true } },
  contract: { select: { quantityUnit: true, currency: true } },
  traceabilityLinks: { select: { batch: { select: { batchRef: true, commodityId: true } } } },
} satisfies Prisma.TradeInclude;
type ReportTrade = Prisma.TradeGetPayload<{ include: typeof tradeInclude }>;

function kgFactor(trade: ReportTrade, unit: string) {
  if (unit.toUpperCase() === trade.commodity.unit.toUpperCase() && trade.commodity.canonicalKgPerUnit != null) {
    const n = Number(trade.commodity.canonicalKgPerUnit);
    return n > 0 ? n : null;
  }
  // Do not silently treat unknown units (or variable bag/bale sizes) as tonnes.
  if (["BAG", "BALE", "BUSHEL", "LTR"].includes(unit.toUpperCase())) return null;
  return DEFAULT_KG_PER_UNIT[unit.toUpperCase()] ?? null;
}
function common(t: ReportTrade) {
  return { tradeRef: t.tradeRef, traderName: canonicalTraderName(t.traderName),
    commodityId: t.commodityId, commodity: `${t.commodity.name} (${t.commodity.code})`,
    counterpartyId: t.counterpartyId, counterparty: t.counterparty.name,
    batchRefs: t.traceabilityLinks.map((l) => l.batch.batchRef),
    invalidBatchLink: t.traceabilityLinks.some((l) => l.batch.commodityId !== t.commodityId) };
}
const positive = (n: number) => Number.isFinite(n) && n > 0 ? n : null;

/** Read-only report. No schema changes, posting, or inventory allocation. */
export async function getCommercialReport(db: PrismaClient, filters: ReportFilters, traderName?: string) {
  const until = new Date(`${filters.to}T23:59:59.999+05:00`);
  let movements: ReportMovement[];
  if (filters.basis === "booked") {
    const trades = await db.trade.findMany({
      where: { tradeDate: { lte: until }, tradeStatus: { in: ["LOCKED", "CONFIRMED", "EXECUTED"] }, directSettled: false },
      include: tradeInclude, orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });
    movements = trades.map((t) => {
      const factor = kgFactor(t, t.quantityUnit);
      const canonicalPrice = t.pricePerCanonicalQty == null ? null : positive(Number(t.pricePerCanonicalQty));
      // Legacy canonical quote is safe only when its unit and currency agree.
      const legacyPrice = (!t.priceWeightUnit || t.priceWeightUnit === t.quantityUnit)
        && (!t.priceCurrency || t.priceCurrency === t.currency) ? positive(Number(t.price)) : null;
      const price = canonicalPrice ?? legacyPrice;
      return { ...common(t), id: t.id, date: t.tradeDate.toISOString(), direction: t.direction,
        quantityKg: factor == null ? null : Number(t.quantity) * factor,
        amount: price == null ? null : Number(t.quantity) * price, currency: t.currency,
        reference: t.tradeRef, warehouse: "" };
    });
  } else {
    const [receipts, dispatches] = await db.$transaction([
      db.inboundReceipt.findMany({
        where: { receiveDate: { lte: until }, status: { not: "DRAFT" }, trade: { direction: "BUY", directSettled: false } },
        include: { trade: { include: tradeInclude } }, orderBy: [{ receiveDate: "asc" }, { id: "asc" }],
      }),
      db.outboundDispatch.findMany({
        where: { dispatchDate: { lte: until }, status: "RELEASED", trade: { direction: "SELL", directSettled: false } },
        include: { trade: { include: tradeInclude } }, orderBy: [{ dispatchDate: "asc" }, { id: "asc" }],
      }),
    ], { isolationLevel: "RepeatableRead" });
    movements = [
      ...receipts.map((r): ReportMovement => {
        const factor = kgFactor(r.trade, r.trade.contract?.quantityUnit ?? r.trade.quantityUnit);
        return { ...common(r.trade), id: r.id, date: r.receiveDate.toISOString(), direction: "BUY",
          quantityKg: factor == null ? null : positive(Number(r.allocatedQtyMt) * factor), amount: positive(Number(r.amountDue)),
          currency: r.trade.contract?.currency ?? r.trade.currency, reference: `${r.kcsNo} / ${r.tradeRef}`, warehouse: r.warehouseName };
      }),
      ...dispatches.map((r): ReportMovement => ({ ...common(r.trade), id: r.id, date: r.dispatchDate.toISOString(), direction: "SELL",
        quantityKg: positive(Number(r.invoiceWeightKg)), amount: positive(Number(r.amountDue)),
        currency: r.trade.contract?.currency ?? r.trade.currency, reference: `${r.gatepassNo ?? r.id} / ${r.tradeRef}`, warehouse: r.warehouseName })),
    ];
  }
  return buildCommercialReport(movements, filters, traderName);
}

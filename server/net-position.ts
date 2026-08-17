import type { TradeSeason } from "@prisma/client";
import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import { deskLegsToPkrPerMaund } from "@/lib/desk-mark-price";
import {
  MAUNDS_PER_MT,
  buildRatePkrPerMtByRef,
  computeWeightedPurchasePrice,
} from "@/server/inventory-valuation";

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * One column of the desk's daily "Net Position" mail, computed live:
 *
 *   Net Position = Open Purchases + Inventory (At Warehouse) − Open Sales
 *
 * Open Purchases is paper still to arrive — the undelivered remainder of open
 * BUY contracts. Open Sales is paper still to ship. Inventory is what the
 * warehouses actually hold: receipts in, dispatches out, plus internal shifts.
 * Market rate and FX are desk-entered per season (Daily Prices, then
 * PositionMarketInput fallback); the entry rate is the inventory weighted
 * purchase price (Execution → Inventory stat) scoped to that season's BUY receipts.
 */
export type SeasonNetPosition = {
  commodityCode: string;
  commodityName: string;
  season: TradeSeason;
  /** e.g. "Corn Summer" — the column header of the mail. */
  label: string;
  openPurchasesMt: number;
  inventoryMt: number;
  openSalesMt: number;
  netPositionMt: number;
  tradeEntryRatePkrPerMaund: number | null;
  /** Shown when entry rate is blank but inventory exists (e.g. winter transfers). */
  entryRateNote: string | null;
  marketRatePkrPerMaund: number | null;
  /** Where the market rate came from — Daily Prices, or the desk's fallback. */
  marketRateSource: "DAILY_PRICES" | "FALLBACK" | null;
  /** Daily Prices only: the date that price was published for. */
  marketRateDate: string | null;
  fxRate: number | null;
  inOutPerMaund: number | null;
  inOutValuePkr: number | null;
  inOutValueUsd: number | null;
  marketInputUpdatedAt: Date | null;
  marketInputUpdatedBy: string | null;
};

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function bucketKey(code: string, season: TradeSeason): string {
  return `${code}::${season}`;
}

export async function getSeasonNetPositions(): Promise<SeasonNetPosition[]> {
  const [trades, contracts, receipts, outbound, transfers, inputs, deskPrices] = await Promise.all([
    prisma.trade.findMany({
      where: { tradeStatus: { not: "CANCELLED" } },
      select: {
        tradeRef: true,
        direction: true,
        season: true,
        commodity: { select: { code: true, name: true } },
      },
    }),
    prisma.executionContract.findMany({
      select: {
        tradeRef: true,
        contractStatus: true,
        openQtyMt: true,
        receivedQtyMt: true,
        contractualQtyMt: true,
        ratePerKg: true,
        ratePerMaund: true,
      },
    }),
    prisma.inboundReceipt.groupBy({
      by: ["tradeRef"],
      where: { status: { not: "DRAFT" } },
      _sum: { allocatedQtyMt: true },
    }),
    prisma.outboundDispatch.groupBy({
      by: ["tradeRef"],
      where: { status: { in: ["WEIGHED", "FINANCE_PENDING", "RELEASED"] } },
      _sum: { allocatedQtyMt: true },
    }),
    prisma.stockTransfer.findMany({
      where: { status: "RECEIVED" },
      select: { commodityCode: true, season: true, receivedQtyMt: true, dispatchedQtyMt: true, externalOrigin: true },
    }),
    prisma.positionMarketInput.findMany(),
    prisma.deskMarketPrice.findMany({
      select: {
        commodityCode: true,
        season: true,
        cnfAmount: true,
        cnfCurrency: true,
        cnfUnit: true,
        yestAmount: true,
        yestCurrency: true,
        yestUnit: true,
        priceDate: true,
      },
    }),
  ]);

  const contractByRef = new Map(contracts.map((c) => [c.tradeRef, c]));
  const inboundByRef = new Map(receipts.map((r) => [r.tradeRef, num(r._sum.allocatedQtyMt)]));
  const outboundByRef = new Map(outbound.map((r) => [r.tradeRef, num(r._sum.allocatedQtyMt)]));
  const ratePkrPerMtByRef = buildRatePkrPerMtByRef(contracts);
  const buyTradeMeta = new Map(
    trades
      .filter((t) => t.direction === "BUY")
      .map((t) => [t.tradeRef, { commodityCode: t.commodity.code, season: t.season }]),
  );

  type Bucket = {
    commodityCode: string;
    commodityName: string;
    season: TradeSeason;
    openPurchasesMt: number;
    openSalesMt: number;
    inventoryMt: number;
  };
  const buckets = new Map<string, Bucket>();
  const bucketOf = (code: string, name: string, season: TradeSeason): Bucket => {
    const key = bucketKey(code, season);
    let b = buckets.get(key);
    if (!b) {
      b = {
        commodityCode: code,
        commodityName: name,
        season,
        openPurchasesMt: 0,
        openSalesMt: 0,
        inventoryMt: 0,
      };
      buckets.set(key, b);
    }
    return b;
  };

  for (const t of trades) {
    const b = bucketOf(t.commodity.code, t.commodity.name, t.season);
    const contract = contractByRef.get(t.tradeRef);
    const openMt = contract && contract.contractStatus === "Open" ? num(contract.openQtyMt) : 0;
    if (t.direction === "BUY") {
      b.openPurchasesMt += openMt;
      const inMt = inboundByRef.get(t.tradeRef) ?? 0;
      b.inventoryMt += inMt - (outboundByRef.get(t.tradeRef) ?? 0);
    } else {
      b.openSalesMt += openMt;
      b.inventoryMt -= outboundByRef.get(t.tradeRef) ?? 0;
    }
  }

  for (const s of transfers) {
    if (!s.externalOrigin) continue;
    const b = bucketOf(s.commodityCode, s.commodityCode, s.season);
    b.inventoryMt += numOrNull(s.receivedQtyMt) ?? num(s.dispatchedQtyMt);
  }

  const inputByKey = new Map(inputs.map((i) => [bucketKey(i.commodityCode, i.season), i]));

  const deskRateByKey = new Map<string, { rate: number; date: string }>();
  for (const p of deskPrices) {
    const yestAmount = numOrNull(p.yestAmount);
    const cnfAmount = numOrNull(p.cnfAmount);
    const perMaund = deskLegsToPkrPerMaund(
      yestAmount != null && yestAmount > 0 && p.yestCurrency && p.yestUnit
        ? { amount: yestAmount, currency: p.yestCurrency, unit: p.yestUnit }
        : null,
      cnfAmount != null && cnfAmount > 0 && p.cnfCurrency && p.cnfUnit
        ? { amount: cnfAmount, currency: p.cnfCurrency, unit: p.cnfUnit }
        : null,
    );
    if (perMaund == null) continue;
    deskRateByKey.set(bucketKey(p.commodityCode, p.season), {
      rate: perMaund,
      date: p.priceDate,
    });
  }

  return [...buckets.values()]
    .filter((b) => b.openPurchasesMt || b.openSalesMt || b.inventoryMt)
    .sort((a, z) => a.commodityCode.localeCompare(z.commodityCode) || a.season.localeCompare(z.season))
    .map((b) => {
      const input = inputByKey.get(bucketKey(b.commodityCode, b.season));
      const desk = deskRateByKey.get(bucketKey(b.commodityCode, b.season));
      const fallback = input?.marketRatePkrPerMaund != null ? num(input.marketRatePkrPerMaund) : null;
      const market = desk?.rate ?? fallback;
      const marketRateSource: SeasonNetPosition["marketRateSource"] =
        desk ? "DAILY_PRICES" : fallback != null ? "FALLBACK" : null;
      const fx = input?.fxRate != null ? num(input.fxRate) : null;
      const { weightedPurchasePricePkrPerMaund } = computeWeightedPurchasePrice({
        inboundQtyByTradeRef: inboundByRef,
        ratePkrPerMtByRef,
        tradeFilter: (tradeRef) => {
          const meta = buyTradeMeta.get(tradeRef);
          return meta?.commodityCode === b.commodityCode && meta.season === b.season;
        },
      });
      const entry =
        weightedPurchasePricePkrPerMaund != null ? round2(weightedPurchasePricePkrPerMaund) : null;
      const entryRateNote =
        entry == null && b.inventoryMt > 0
          ? "No rated inbound receipts for this season — stock from transfers or purchases without a contract rate."
          : null;
      const netMt = round2(b.openPurchasesMt + b.inventoryMt - b.openSalesMt);
      const perMaund = market != null && entry != null ? round2(market - entry) : null;
      const valuePkr = perMaund != null ? round2(perMaund * netMt * MAUNDS_PER_MT) : null;
      const valueUsd = valuePkr != null && fx != null && fx > 0 ? round2(valuePkr / fx) : null;
      return {
        commodityCode: b.commodityCode,
        commodityName: b.commodityName || b.commodityCode,
        season: b.season,
        label: `${titleCase(b.commodityName || b.commodityCode)} ${titleCase(b.season)}`,
        openPurchasesMt: round2(b.openPurchasesMt),
        inventoryMt: round2(b.inventoryMt),
        openSalesMt: round2(b.openSalesMt),
        netPositionMt: netMt,
        tradeEntryRatePkrPerMaund: entry,
        entryRateNote,
        marketRatePkrPerMaund: market,
        marketRateSource,
        marketRateDate: desk?.date ?? null,
        fxRate: fx,
        inOutPerMaund: perMaund,
        inOutValuePkr: valuePkr,
        inOutValueUsd: valueUsd,
        marketInputUpdatedAt: input?.updatedAt ?? null,
        marketInputUpdatedBy: input?.updatedBy ?? null,
      };
    });
}

/** Desk sets the day's market rate / FX for one commodity + season column. */
export async function setPositionMarketInput(input: {
  commodityCode: string;
  season: TradeSeason;
  marketRatePkrPerMaund?: number | null;
  fxRate?: number | null;
  updatedBy: string;
}): Promise<void> {
  await prisma.positionMarketInput.upsert({
    where: {
      commodityCode_season: { commodityCode: input.commodityCode, season: input.season },
    },
    create: {
      commodityCode: input.commodityCode,
      season: input.season,
      marketRatePkrPerMaund: input.marketRatePkrPerMaund ?? null,
      fxRate: input.fxRate ?? null,
      updatedBy: input.updatedBy,
    },
    update: {
      ...(input.marketRatePkrPerMaund !== undefined
        ? { marketRatePkrPerMaund: input.marketRatePkrPerMaund }
        : {}),
      ...(input.fxRate !== undefined ? { fxRate: input.fxRate } : {}),
      updatedBy: input.updatedBy,
    },
  });
}

/** Season-wise stock on hand — the inventory page's season cards. */
export async function getSeasonInventory(): Promise<
  Array<{ commodityCode: string; season: TradeSeason; label: string; qtyMt: number }>
> {
  const rows = await getSeasonNetPositions();
  return rows.map((r) => ({
    commodityCode: r.commodityCode,
    season: r.season,
    label: r.label,
    qtyMt: r.inventoryMt,
  }));
}

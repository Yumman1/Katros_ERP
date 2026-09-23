import { TradeStatus } from "@prisma/client";
import { addDays, startOfDay } from "date-fns";
import { canonicalTraderName } from "@/lib/trader-identity";
import { isActiveTraderTrade, isExecutionUnreviewed } from "@/lib/trade-lifecycle";
import { getLockedContracts } from "@/server/execution/contracts";
import { mockTraderTrades, type MockTraderTrade } from "@/server/dummy-data";
import { enrichTradesMtmUsd } from "@/server/finance/mtm-usd";
import { roundUsd, settlementBaseOf } from "@/lib/settlement-usd";

/** Locked contracts fully fulfilled are treated as executed on the trader book. */
export async function overlayFulfilledContracts(
  trades: MockTraderTrade[],
): Promise<MockTraderTrade[]> {
  const closedRefs = new Set(
    (await getLockedContracts({ openOnly: false }))
      .filter((c) => c.contractStatus !== "Open")
      .map((c) => c.tradeRef),
  );
  return trades.map((t) =>
    (t.tradeStatus === TradeStatus.LOCKED || t.tradeStatus === TradeStatus.CONFIRMED) &&
    closedRefs.has(t.tradeRef)
      ? { ...t, tradeStatus: TradeStatus.EXECUTED }
      : t,
  );
}

export async function getTraderBookTrades(traderName: string, commodityId?: string): Promise<MockTraderTrade[]> {
  const raw = await mockTraderTrades(canonicalTraderName(traderName), { commodityId });
  const overlaid = await overlayFulfilledContracts(raw);
  return enrichTradesMtmUsd(overlaid);
}

export { isActiveTraderTrade } from "@/lib/trade-lifecycle";

export function isCollectingSettlement(t: MockTraderTrade): boolean {
  return t.directSettled === true && t.settlementClosedAt == null;
}

function deliveryOverlapsWeek(t: MockTraderTrade, weekStart: Date, weekEnd: Date): boolean {
  return t.deliveryStart <= weekEnd && t.deliveryEnd >= weekStart;
}

export async function buildTraderDeskSummary(traderName: string, commodityId?: string) {
  const trades = await getTraderBookTrades(traderName, commodityId);

  const active = trades.filter(isActiveTraderTrade);
  const pendingAction = trades.filter(
    (t) =>
      t.tradeStatus === TradeStatus.PENDING &&
      (t.pendingTraderReview ||
        t.pendingTraderPrice ||
        isExecutionUnreviewed(t)),
  );

  const todayStart = startOfDay(new Date());
  const weekEnd = addDays(todayStart, 7);
  const deliveriesDue = active.filter(
    (t) =>
      (t.tradeStatus === TradeStatus.LOCKED || t.tradeStatus === TradeStatus.CONFIRMED) &&
      deliveryOverlapsWeek(t, todayStart, weekEnd),
  );

  const bookedToday = trades.filter((t) => t.tradeDate >= todayStart);

  const openMtmTrades = active.filter(
    (t) => t.tradeStatus === TradeStatus.LOCKED || t.tradeStatus === TradeStatus.CONFIRMED,
  );
  const myMtmUsd = roundUsd(
    openMtmTrades.reduce((a, t) => a + (t.mtmPnlUsd ?? 0), 0),
  );
  const mtmUnconverted = openMtmTrades.filter((t) => t.mtmPnlUsd == null).length;

  const deskLabel =
    trades.find((t) => t.desk?.trim())?.desk?.replace(/_/g, " ") ?? "Desk";

  return {
    traderName,
    desk: deskLabel,
    openTrades: active.length,
    pendingConfirmation: pendingAction.length,
    deliveriesThisWeek: deliveriesDue.length,
    bookedToday: bookedToday.length,
    todayVolumeMt: bookedToday.reduce((a, t) => a + t.quantity, 0),
    /** Open locked/confirmed MTM in USD (PKR legs converted at desk FX). */
    myMtm: myMtmUsd,
    mtmUnconverted,
    openNotional: active.reduce(
      (a, t) => a + t.quantity * (t.pricePerCanonicalQty ?? t.price),
      0,
    ),
  };
}

export type TraderExposureRow = {
  code: string;
  name: string;
  long: number;
  short: number;
  net: number;
  /** MTM in USD for display. */
  mtm: number;
  /** Sum of MTM in native settlement currency before FX. */
  mtmNative: number;
  mtmCurrency: ReturnType<typeof settlementBaseOf>;
  mtmUnconverted: number;
  marketPrice: number;
  marketCurrency?: string;
  marketUnit?: string;
};

const EXPOSURE_STATUSES: TradeStatus[] = [
  TradeStatus.CONFIRMED,
  TradeStatus.EXECUTED,
  TradeStatus.LOCKED,
  TradeStatus.PENDING,
];

export async function buildTraderExposure(traderName: string, commodityId?: string): Promise<TraderExposureRow[]> {
  const trades = await getTraderBookTrades(traderName, commodityId);
  const exposureTrades = trades.filter((t) => EXPOSURE_STATUSES.includes(t.tradeStatus));

  const byCommodity = new Map<
    string,
    {
      code: string;
      name: string;
      long: number;
      short: number;
      mtmNative: number;
      mtmUsd: number;
      mtmUnconverted: number;
      mtmCurrency: ReturnType<typeof settlementBaseOf>;
      marketPrice: number;
    }
  >();

  for (const t of exposureTrades) {
    const cur = byCommodity.get(t.commodity.code) ?? {
      code: t.commodity.code,
      name: t.commodity.name,
      long: 0,
      short: 0,
      mtmNative: 0,
      mtmUsd: 0,
      mtmUnconverted: 0,
      mtmCurrency: settlementBaseOf(t),
      marketPrice: t.marketPrice,
    };
    if (t.direction === "BUY") cur.long += t.quantity;
    else cur.short += t.quantity;
    cur.mtmNative += t.mtmPnl;
    if (t.mtmPnlUsd != null) cur.mtmUsd += t.mtmPnlUsd;
    else cur.mtmUnconverted += 1;
    byCommodity.set(t.commodity.code, cur);
  }

  const { getDeskMarketPrice } = await import("@/server/market-prices");
  const { positionMarkLeg } = await import("@/lib/desk-mark-price");

  return Promise.all(
    Array.from(byCommodity.values()).map(async (c) => {
      const desk = await getDeskMarketPrice(c.code);
      const ref = positionMarkLeg(desk);
      return {
        code: c.code,
        name: c.name,
        long: c.long,
        short: c.short,
        net: c.long - c.short,
        mtm: roundUsd(c.mtmUsd),
        mtmNative: c.mtmNative,
        mtmCurrency: c.mtmCurrency,
        mtmUnconverted: c.mtmUnconverted,
        marketPrice: ref?.amount ?? c.marketPrice,
        marketCurrency: ref?.currency,
        marketUnit: ref?.unit,
      };
    }),
  );
}

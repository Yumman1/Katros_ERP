import {
  amountToUsd,
  fxMapKey,
  resolveFxRateForTrade,
  roundUsd,
  settlementBaseOf,
} from "@/lib/settlement-usd";
import { num } from "@/server/db/convert";
import { prisma } from "@/server/db";
import type { MockTraderTrade } from "@/server/dummy-data";

/** Desk PKR/USD rates keyed by `COMMODITY::SEASON` (PositionMarketInput). */
export async function loadDeskFxRates(): Promise<Map<string, number>> {
  const rows = await prisma.positionMarketInput.findMany({
    select: { commodityCode: true, season: true, fxRate: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const fx = num(r.fxRate);
    if (fx > 0) map.set(fxMapKey(r.commodityCode, r.season), fx);
  }
  return map;
}

export function tradeMtmToUsd(
  trade: MockTraderTrade,
  fxMap: ReadonlyMap<string, number>,
): number | null {
  const base = settlementBaseOf(trade);
  const fx = resolveFxRateForTrade(fxMap, trade.commodity.code, trade.season);
  return amountToUsd(trade.mtmPnl, base, fx);
}

export function enrichTradeMtmUsd(
  trade: MockTraderTrade,
  fxMap: ReadonlyMap<string, number>,
): MockTraderTrade {
  const usd = tradeMtmToUsd(trade, fxMap);
  return { ...trade, mtmPnlUsd: usd != null ? roundUsd(usd) : null };
}

export async function enrichTradesMtmUsd(trades: MockTraderTrade[]): Promise<MockTraderTrade[]> {
  const fxMap = await loadDeskFxRates();
  return trades.map((t) => enrichTradeMtmUsd(t, fxMap));
}

export function sumTradesMtmUsd(
  trades: MockTraderTrade[],
  fxMap: ReadonlyMap<string, number>,
): { totalUsd: number; unconvertedCount: number } {
  let totalUsd = 0;
  let unconvertedCount = 0;
  for (const t of trades) {
    const usd = tradeMtmToUsd(t, fxMap);
    if (usd == null) {
      unconvertedCount++;
      continue;
    }
    totalUsd += usd;
  }
  return { totalUsd: roundUsd(totalUsd), unconvertedCount };
}

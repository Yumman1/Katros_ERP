import { TradeDirection, TradeStatus } from "@prisma/client";
import { canonicalTraderName } from "@/lib/trader-identity";
import { isActiveTraderTrade } from "@/lib/trade-lifecycle";
import { roundUsd } from "@/lib/settlement-usd";
import { getLockedContracts } from "@/server/execution/contracts";
import { getInboundReceipts } from "@/server/execution/movements";
import { getCounterpartyLedgers } from "@/server/finance/ledger";
import {
  buildRatePkrPerMtByRef,
  computeWeightedPurchasePrice,
} from "@/server/inventory-valuation";
import { prisma } from "@/server/db";
import { getTraderBookTrades } from "@/server/trader-book";

export type TraderReportFilters = {
  counterpartyId?: string;
  commodityCode?: string;
  direction?: TradeDirection;
};

export type TraderReportCounterpartyOption = {
  id: string;
  name: string;
  code: string;
};

export type TraderCounterpartyReportRow = {
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  tradeCount: number;
  openBuyQtyMt: number;
  openSellQtyMt: number;
  fulfilledQtyMt: number;
  /** Receipt-weighted purchase cost (PKR/MT) for this counterparty's BUY trades. */
  weightedAvgCostPkrPerMt: number | null;
  weightedAvgCostPkrPerMaund: number | null;
  /** Open BUY paper: Σ(openQty × contract rate) / Σ(openQty). */
  openPaperAvgRatePkrPerMt: number | null;
  mtmUsd: number;
  mtmUnconverted: number;
  buyOutstandingPkr: number;
  sellOutstandingPkr: number;
};

export type TraderReportTradeRow = {
  tradeRef: string;
  tradeDate: Date;
  direction: TradeDirection;
  tradeStatus: TradeStatus;
  commodityCode: string;
  commodityName: string;
  quantity: number;
  quantityUnit: string;
  price: number;
  currency: string;
  openQtyMt: number;
  fulfilledQtyMt: number;
  mtmPnlUsd: number | null;
  mtmPnl: number;
};

export type TraderCounterpartyReportSummary = {
  counterpartyCount: number;
  tradeCount: number;
  openBuyQtyMt: number;
  openSellQtyMt: number;
  fulfilledQtyMt: number;
  mtmUsd: number;
  mtmUnconverted: number;
  buyOutstandingPkr: number;
  sellOutstandingPkr: number;
};

export type TraderCounterpartyReport = {
  counterparties: TraderReportCounterpartyOption[];
  rows: TraderCounterpartyReportRow[];
  trades: TraderReportTradeRow[];
  summary: TraderCounterpartyReportSummary;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

function matchesCommodity(code: string, filter?: string): boolean {
  if (!filter || filter === "ALL") return true;
  return code === filter;
}

function matchesDirection(direction: TradeDirection, filter?: TradeDirection): boolean {
  if (!filter) return true;
  return direction === filter;
}

export async function buildTraderCounterpartyReport(
  traderName: string,
  filters: TraderReportFilters = {},
): Promise<TraderCounterpartyReport> {
  const name = canonicalTraderName(traderName);
  const [trades, contracts, receipts, ledgers, contractRows] = await Promise.all([
    getTraderBookTrades(name),
    getLockedContracts({}),
    getInboundReceipts(),
    getCounterpartyLedgers(),
    prisma.executionContract.findMany({
      select: { tradeRef: true, ratePerKg: true, ratePerMaund: true },
    }),
  ]);

  const traderContracts = contracts.filter((c) => c.traderName === name);
  const ratePkrPerMtByRef = buildRatePkrPerMtByRef(contractRows);

  const receiptQtyByTradeRef = new Map<string, number>();
  for (const r of receipts) {
    const qty = r.allocatedQtyMt;
    if (qty <= 0) continue;
    receiptQtyByTradeRef.set(r.tradeRef, (receiptQtyByTradeRef.get(r.tradeRef) ?? 0) + qty);
  }

  const contractByRef = new Map(traderContracts.map((c) => [c.tradeRef, c]));
  const tradeRefToCpId = new Map(trades.map((t) => [t.tradeRef, t.counterparty.id]));

  type CpAgg = {
    counterpartyId: string;
    counterpartyName: string;
    counterpartyCode: string;
    tradeRefs: Set<string>;
    openBuyQtyMt: number;
    openSellQtyMt: number;
    fulfilledQtyMt: number;
    openPaperValuePkr: number;
    openPaperQtyMt: number;
    mtmUsd: number;
    mtmUnconverted: number;
  };

  const byCp = new Map<string, CpAgg>();

  function ensureCp(id: string, cpName: string, cpCode: string): CpAgg {
    let agg = byCp.get(id);
    if (!agg) {
      agg = {
        counterpartyId: id,
        counterpartyName: cpName,
        counterpartyCode: cpCode,
        tradeRefs: new Set(),
        openBuyQtyMt: 0,
        openSellQtyMt: 0,
        fulfilledQtyMt: 0,
        openPaperValuePkr: 0,
        openPaperQtyMt: 0,
        mtmUsd: 0,
        mtmUnconverted: 0,
      };
      byCp.set(id, agg);
    }
    return agg;
  }

  for (const t of trades) {
    if (!matchesCommodity(t.commodity.code, filters.commodityCode)) continue;
    if (!matchesDirection(t.direction, filters.direction)) continue;
    if (filters.counterpartyId && t.counterparty.id !== filters.counterpartyId) continue;

    const agg = ensureCp(t.counterparty.id, t.counterparty.name, t.counterparty.code);
    agg.tradeRefs.add(t.tradeRef);

    const isMtmEligible =
      t.tradeStatus === TradeStatus.LOCKED || t.tradeStatus === TradeStatus.CONFIRMED;
    if (isMtmEligible) {
      if (t.mtmPnlUsd != null) agg.mtmUsd += t.mtmPnlUsd;
      else agg.mtmUnconverted += 1;
    }
  }

  for (const c of traderContracts) {
    const cpId = tradeRefToCpId.get(c.tradeRef);
    if (!cpId) continue;
    if (!matchesCommodity(c.commodityCode, filters.commodityCode)) continue;
    if (!matchesDirection(c.direction, filters.direction)) continue;
    if (filters.counterpartyId && cpId !== filters.counterpartyId) continue;

    const trade = trades.find((t) => t.tradeRef === c.tradeRef);
    if (!trade) continue;

    const agg = ensureCp(cpId, trade.counterparty.name, trade.counterparty.code);
    agg.fulfilledQtyMt += c.receivedQtyMt;

    if (c.contractStatus === "Open") {
      if (c.direction === TradeDirection.BUY) {
        agg.openBuyQtyMt += c.openQtyMt;
        const rate = ratePkrPerMtByRef.get(c.tradeRef);
        if (rate != null && c.openQtyMt > 0) {
          agg.openPaperValuePkr += c.openQtyMt * rate;
          agg.openPaperQtyMt += c.openQtyMt;
        }
      } else {
        agg.openSellQtyMt += c.openQtyMt;
      }
    }
  }

  const ledgerByCpSide = new Map<string, { buy: number; sell: number }>();
  for (const acct of ledgers) {
    const cur = ledgerByCpSide.get(acct.counterpartyId) ?? { buy: 0, sell: 0 };
    if (acct.side === "BUY") cur.buy = acct.outstandingDebitPkr;
    else cur.sell = acct.outstandingDebitPkr;
    ledgerByCpSide.set(acct.counterpartyId, cur);
  }

  const counterparties: TraderReportCounterpartyOption[] = [];
  const cpSeen = new Set<string>();
  for (const t of trades) {
    if (cpSeen.has(t.counterparty.id)) continue;
    cpSeen.add(t.counterparty.id);
    counterparties.push({
      id: t.counterparty.id,
      name: t.counterparty.name,
      code: t.counterparty.code,
    });
  }
  counterparties.sort((a, b) => a.name.localeCompare(b.name));

  const rows: TraderCounterpartyReportRow[] = [];

  for (const agg of byCp.values()) {
    const buyTradeRefs = new Set<string>();
    for (const ref of agg.tradeRefs) {
      const t = trades.find((tr) => tr.tradeRef === ref);
      if (t?.direction === TradeDirection.BUY) buyTradeRefs.add(ref);
    }

    const wac = computeWeightedPurchasePrice({
      inboundQtyByTradeRef: receiptQtyByTradeRef,
      ratePkrPerMtByRef,
      tradeFilter: (ref) => buyTradeRefs.has(ref),
    });

    const ledger = ledgerByCpSide.get(agg.counterpartyId) ?? { buy: 0, sell: 0 };

    rows.push({
      counterpartyId: agg.counterpartyId,
      counterpartyName: agg.counterpartyName,
      counterpartyCode: agg.counterpartyCode,
      tradeCount: agg.tradeRefs.size,
      openBuyQtyMt: round2(agg.openBuyQtyMt),
      openSellQtyMt: round2(agg.openSellQtyMt),
      fulfilledQtyMt: round2(agg.fulfilledQtyMt),
      weightedAvgCostPkrPerMt: wac.weightedPurchasePricePkrPerMt,
      weightedAvgCostPkrPerMaund: wac.weightedPurchasePricePkrPerMaund,
      openPaperAvgRatePkrPerMt:
        agg.openPaperQtyMt > 0 ? round2(agg.openPaperValuePkr / agg.openPaperQtyMt) : null,
      mtmUsd: roundUsd(agg.mtmUsd),
      mtmUnconverted: agg.mtmUnconverted,
      buyOutstandingPkr: round2(ledger.buy),
      sellOutstandingPkr: round2(ledger.sell),
    });
  }

  rows.sort((a, b) => a.counterpartyName.localeCompare(b.counterpartyName));

  const tradeRows: TraderReportTradeRow[] = trades
    .filter((t) => {
      if (!matchesCommodity(t.commodity.code, filters.commodityCode)) return false;
      if (!matchesDirection(t.direction, filters.direction)) return false;
      if (filters.counterpartyId && t.counterparty.id !== filters.counterpartyId) return false;
      return isActiveTraderTrade(t) || contractByRef.has(t.tradeRef);
    })
    .map((t) => {
      const c = contractByRef.get(t.tradeRef);
      return {
        tradeRef: t.tradeRef,
        tradeDate: t.tradeDate,
        direction: t.direction,
        tradeStatus: t.tradeStatus,
        commodityCode: t.commodity.code,
        commodityName: t.commodity.name,
        quantity: t.quantity,
        quantityUnit: t.quantityUnit ?? t.commodity.unit,
        price: t.pricePerCanonicalQty ?? t.price,
        currency: t.currency,
        openQtyMt: c?.openQtyMt ?? 0,
        fulfilledQtyMt: c?.receivedQtyMt ?? 0,
        mtmPnlUsd: t.mtmPnlUsd ?? null,
        mtmPnl: t.mtmPnl,
      };
    })
    .sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime());

  const summary: TraderCounterpartyReportSummary = {
    counterpartyCount: rows.length,
    tradeCount: rows.reduce((a, r) => a + r.tradeCount, 0),
    openBuyQtyMt: round2(rows.reduce((a, r) => a + r.openBuyQtyMt, 0)),
    openSellQtyMt: round2(rows.reduce((a, r) => a + r.openSellQtyMt, 0)),
    fulfilledQtyMt: round2(rows.reduce((a, r) => a + r.fulfilledQtyMt, 0)),
    mtmUsd: roundUsd(rows.reduce((a, r) => a + r.mtmUsd, 0)),
    mtmUnconverted: rows.reduce((a, r) => a + r.mtmUnconverted, 0),
    buyOutstandingPkr: round2(rows.reduce((a, r) => a + r.buyOutstandingPkr, 0)),
    sellOutstandingPkr: round2(rows.reduce((a, r) => a + r.sellOutstandingPkr, 0)),
  };

  return { counterparties, rows, trades: tradeRows, summary };
}

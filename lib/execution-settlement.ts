import { isSesameCommodity } from "./sesame";
import { currencyToBaseFactor } from "./price-units";

export function sesameSettlementFx(trade: { commodity: { code: string; name?: string }; currency?: string; tradeParams?: Record<string, unknown> | null }): number {
  if (!isSesameCommodity(trade.commodity.code, trade.commodity.name) || trade.currency !== "USD") return 1;
  const fx = Number(trade.tradeParams?.executionFxPkrPerUsd);
  if (!Number.isFinite(fx) || fx <= 0) throw new Error("Set the Sesame USD/PKR rate in Positions before locking this trade");
  return fx;
}

export function executionTradeValuePkr(trade: {
  commodity: { code: string; name?: string }; currency?: string;
  tradeParams?: unknown; quantity: number; pricePerMt: number;
  commissionAmount: number; priceCurrency?: string | null;
}): number {
  const sesame = isSesameCommodity(trade.commodity.code, trade.commodity.name);
  const fx = sesameSettlementFx({ ...trade, tradeParams: trade.tradeParams as Record<string, unknown> | null });
  const commission = trade.commissionAmount * (sesame && trade.priceCurrency === "USd" ? currencyToBaseFactor("USd") : 1);
  return (trade.quantity * trade.pricePerMt + commission) * fx;
}

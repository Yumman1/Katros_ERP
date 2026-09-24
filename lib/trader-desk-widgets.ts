export const DESK_WIDGETS = [
  { id: "totalBought", label: "Total bought" },
  { id: "inventory", label: "Inventory" },
  { id: "totalSold", label: "Total sold" },
  { id: "openTrades", label: "Open trades" },
  { id: "deliveries", label: "Deliveries this week" },
  { id: "bookedToday", label: "Booked today" },
  { id: "todayVolume", label: "Today's volume" },
  { id: "openMtm", label: "My open MTM" },
  { id: "exposure", label: "My exposure by commodity" },
  { id: "mtmCommodity", label: "MTM by commodity" },
  { id: "tradeList", label: "My open trades" },
  { id: "actions", label: "Action required" },
  { id: "overdue", label: "Company-wide overdue payments" },
  { id: "reports", label: "Counterparty reports" },
] as const;
export type DeskWidgetId = typeof DESK_WIDGETS[number]["id"];
export function restoreHiddenWidgets(value: unknown): DeskWidgetId[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(DESK_WIDGETS.map(w => w.id));
  return [...new Set(value.filter((id): id is DeskWidgetId => typeof id === "string" && allowed.has(id)))];
}
export function widgetStorageKey(userId: string, commodityId: string) {
  return `trader-desk-widgets:v1:${userId}:${commodityId}`;
}
/** Cumulative committed physical contracts in MT, excluding drafts, cancellations and cash-only settlements. */
export function committedTradeTotals(trades: readonly { direction: string; quantity: number; tradeStatus: string; directSettled?: boolean | null }[]) {
  let totalBoughtMt = 0, totalSoldMt = 0;
  for (const trade of trades) {
    if (trade.directSettled || !["LOCKED", "CONFIRMED", "EXECUTED", "SETTLED"].includes(trade.tradeStatus)) continue;
    if (trade.direction === "BUY") totalBoughtMt += trade.quantity;
    if (trade.direction === "SELL") totalSoldMt += trade.quantity;
  }
  return { totalBoughtMt, totalSoldMt };
}

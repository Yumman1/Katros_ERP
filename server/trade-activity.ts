import { buildTradeEditPreviewRows, countChangedRows } from "@/lib/change-request-trade-preview";
import type { TradePreviewSource } from "@/lib/change-request-trade-preview";
import { listChangeRequests, type ChangeRequest } from "@/server/change-requests-store";
import {
  mockTradeByRefGlobal,
  syncBookedTradesFromDisk,
  upsertBookedTrade,
  type MockTraderTrade,
} from "@/server/dummy-data";
import type { OpenTradePatch } from "@/server/open-trades";

export type TradeActivityKind =
  | "EDIT_APPLIED"
  | "EDIT_REQUESTED"
  | "EDIT_APPROVED"
  | "EDIT_REJECTED"
  | "DELETE_REQUESTED";

export type TradeActivityEntry = {
  id: string;
  at: Date;
  actorName: string;
  actorSide: "TRADER" | "EXECUTION" | "CEO";
  kind: TradeActivityKind;
  requiresApproval: boolean;
  summary: string;
  note?: string | null;
  changeCount?: number;
  changeRequestId?: string;
  payload?: Record<string, unknown> | null;
};

function nextActivityId(trade: MockTraderTrade): string {
  const n = (trade.activityLog?.length ?? 0) + 1;
  return `${trade.tradeRef}-act-${n}`;
}

function tradeAsPreviewSource(trade: MockTraderTrade): TradePreviewSource {
  return {
    tradeRef: trade.tradeRef,
    commodityCode: trade.commodity.code,
    counterparty: trade.counterparty,
    quantityEntered: trade.quantityEntered,
    quantityEnteredUnit: trade.quantityEnteredUnit,
    quantity: trade.quantity,
    quantityUnit: trade.quantityUnit,
    price: trade.price,
    priceCurrency: trade.priceCurrency,
    priceWeightUnit: trade.priceWeightUnit,
    deliveryStart: trade.deliveryStart,
    deliveryEnd: trade.deliveryEnd,
    incoterms: trade.incoterms,
    paymentType: trade.paymentType,
    originName: trade.originName,
    productOrigin: trade.productOrigin,
    grade: trade.grade,
    notes: trade.notes,
    commissionAmount: trade.commissionAmount,
    qualityTolerances: trade.qualityTolerances,
    qualityTolerancesDetail: trade.qualityTolerancesDetail,
    tradeParams: trade.tradeParams,
  };
}

function summarizePatch(trade: MockTraderTrade, patch: Record<string, unknown>): {
  summary: string;
  changeCount: number;
} {
  const rows = buildTradeEditPreviewRows(tradeAsPreviewSource(trade), patch);
  const changed = rows.filter((r) => r.changed);
  const changeCount = countChangedRows(rows);
  if (!changed.length) {
    return { summary: "No field changes recorded", changeCount: 0 };
  }
  const preview = changed
    .slice(0, 4)
    .map((r) => `${r.label}: ${r.before} → ${r.after}`)
    .join(" · ");
  const suffix = changed.length > 4 ? ` (+${changed.length - 4} more)` : "";
  return { summary: preview + suffix, changeCount };
}

export function appendTradeActivity(
  tradeRef: string,
  entry: Omit<TradeActivityEntry, "id" | "at"> & { at?: Date },
): TradeActivityEntry | null {
  syncBookedTradesFromDisk();
  const trade = mockTradeByRefGlobal(tradeRef.trim());
  if (!trade) return null;
  const full: TradeActivityEntry = {
    id: nextActivityId(trade),
    at: entry.at ?? new Date(),
    ...entry,
  };
  trade.activityLog = [full, ...(trade.activityLog ?? [])].slice(0, 100);
  upsertBookedTrade(trade);
  return full;
}

export function recordTradeEditApplied(
  tradeRef: string,
  patch: OpenTradePatch | Record<string, unknown>,
  opts: {
    actorName: string;
    actorSide: TradeActivityEntry["actorSide"];
    requiresApproval: boolean;
    note?: string | null;
    changeRequestId?: string;
  },
): void {
  syncBookedTradesFromDisk();
  const trade = mockTradeByRefGlobal(tradeRef.trim());
  if (!trade) return;
  const payload = patch as Record<string, unknown>;
  const { summary, changeCount } = summarizePatch(trade, payload);
  appendTradeActivity(tradeRef, {
    actorName: opts.actorName,
    actorSide: opts.actorSide,
    kind: opts.requiresApproval ? "EDIT_APPROVED" : "EDIT_APPLIED",
    requiresApproval: opts.requiresApproval,
    summary,
    changeCount,
    note: opts.note ?? null,
    changeRequestId: opts.changeRequestId,
    payload,
  });
}

export function recordTradeChangeRequested(
  req: Pick<
    ChangeRequest,
    "id" | "department" | "entityRef" | "action" | "comment" | "requestedByName" | "payload"
  >,
): void {
  if (req.action !== "EDIT" && req.action !== "DELETE") return;
  syncBookedTradesFromDisk();
  const trade = mockTradeByRefGlobal(req.entityRef.trim());
  const actorSide = req.department === "TRADING" ? "TRADER" : "EXECUTION";
  let summary = req.action === "DELETE" ? "Requested trade deletion" : "Requested trade edit";
  let changeCount: number | undefined;
  if (req.action === "EDIT" && req.payload && trade) {
    const s = summarizePatch(trade, req.payload);
    summary = s.summary;
    changeCount = s.changeCount;
  }
  appendTradeActivity(req.entityRef, {
    actorName: req.requestedByName,
    actorSide,
    kind: req.action === "DELETE" ? "DELETE_REQUESTED" : "EDIT_REQUESTED",
    requiresApproval: true,
    summary,
    changeCount,
    note: req.comment,
    changeRequestId: req.id,
    payload: req.payload ?? null,
  });
}

export function recordTradeChangeResolved(
  req: ChangeRequest,
  decision: "APPROVED" | "REJECTED",
  resolvedByName: string,
): void {
  if (req.entityType !== "TRADE") return;
  appendTradeActivity(req.entityRef, {
    actorName: resolvedByName,
    actorSide: req.status === "PENDING_CEO" || req.department === "TRADING" ? "CEO" : "EXECUTION",
    kind: decision === "APPROVED" ? "EDIT_APPROVED" : "EDIT_REJECTED",
    requiresApproval: true,
    summary:
      decision === "APPROVED"
        ? `${req.action} request approved`
        : `${req.action} request rejected`,
    note: req.resolutionNote ?? null,
    changeRequestId: req.id,
    payload: req.payload ?? null,
  });
}

export function getTradeActivityLog(tradeRef: string): TradeActivityEntry[] {
  syncBookedTradesFromDisk();
  const trade = mockTradeByRefGlobal(tradeRef.trim());
  return (trade?.activityLog ?? []) as TradeActivityEntry[];
}

export function getTradeChangeRequests(tradeRef: string): ChangeRequest[] {
  return listChangeRequests().filter(
    (r) => r.entityType === "TRADE" && r.entityRef === tradeRef.trim(),
  );
}

export function getTradeTimeline(tradeRef: string) {
  const activity = getTradeActivityLog(tradeRef);
  const changeRequests = getTradeChangeRequests(tradeRef);
  const pending = changeRequests.filter(
    (r) => r.status === "PENDING" || r.status === "PENDING_CEO",
  );
  return { activity, changeRequests, pending };
}

import type { Prisma, TradeActivity } from "@prisma/client";
import { buildTradeEditPreviewRows, countChangedRows } from "@/lib/change-request-trade-preview";
import type { TradePreviewSource } from "@/lib/change-request-trade-preview";
import { listChangeRequests, type ChangeRequest } from "@/server/change-requests-store";
import { mockTradeByRefGlobal, type MockTraderTrade } from "@/server/dummy-data";
import { prisma } from "@/server/db";
import { json } from "@/server/db/convert";
import type { OpenTradePatch } from "@/server/open-trades";

export type TradeActivityKind =
  | "EDIT_APPLIED"
  | "EDIT_REQUESTED"
  | "EDIT_APPROVED"
  | "EDIT_REJECTED"
  | "DELETE_REQUESTED"
  | "CLOSED"
  | "CANCELLED"
  | "SETTLEMENT_INVOICED"
  | "SETTLEMENT_CLOSED";

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

function activityRowToEntry(row: TradeActivity): TradeActivityEntry {
  return {
    id: row.id,
    at: row.at,
    actorName: row.actorName,
    actorSide: row.actorSide,
    kind: row.kind as TradeActivityKind,
    requiresApproval: row.requiresApproval,
    summary: row.summary,
    note: row.note,
    changeCount: row.changeCount ?? undefined,
    changeRequestId: row.changeRequestId ?? undefined,
    payload: json<Record<string, unknown>>(row.payload),
  };
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

export async function appendTradeActivity(
  tradeRef: string,
  entry: Omit<TradeActivityEntry, "id" | "at"> & { at?: Date },
): Promise<TradeActivityEntry | null> {
  const trade = await prisma.trade.findUnique({
    where: { tradeRef: tradeRef.trim() },
    select: { id: true },
  });
  if (!trade) return null;
  const row = await prisma.tradeActivity.create({
    data: {
      tradeId: trade.id,
      at: entry.at ?? new Date(),
      actorName: entry.actorName,
      actorSide: entry.actorSide,
      kind: entry.kind,
      requiresApproval: entry.requiresApproval,
      summary: entry.summary,
      note: entry.note ?? null,
      changeCount: entry.changeCount ?? null,
      changeRequestId: entry.changeRequestId ?? null,
      payload: (entry.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  return activityRowToEntry(row);
}

export async function recordTradeEditApplied(
  tradeRef: string,
  patch: OpenTradePatch | Record<string, unknown>,
  opts: {
    actorName: string;
    actorSide: TradeActivityEntry["actorSide"];
    requiresApproval: boolean;
    note?: string | null;
    changeRequestId?: string;
  },
): Promise<void> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  if (!trade) return;
  const payload = patch as Record<string, unknown>;
  const { summary, changeCount } = summarizePatch(trade, payload);
  await appendTradeActivity(tradeRef, {
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

export async function recordTradeChangeRequested(
  req: Pick<
    ChangeRequest,
    "id" | "department" | "entityRef" | "action" | "comment" | "requestedByName" | "payload"
  >,
): Promise<void> {
  if (req.action !== "EDIT" && req.action !== "DELETE") return;
  const trade = await mockTradeByRefGlobal(req.entityRef.trim());
  const actorSide = req.department === "TRADING" ? "TRADER" : "EXECUTION";
  let summary = req.action === "DELETE" ? "Requested trade deletion" : "Requested trade edit";
  let changeCount: number | undefined;
  if (req.action === "EDIT" && req.payload && trade) {
    const s = summarizePatch(trade, req.payload);
    summary = s.summary;
    changeCount = s.changeCount;
  }
  await appendTradeActivity(req.entityRef, {
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

export async function recordTradeChangeResolved(
  req: ChangeRequest,
  decision: "APPROVED" | "REJECTED",
  resolvedByName: string,
): Promise<void> {
  if (req.entityType !== "TRADE") return;
  await appendTradeActivity(req.entityRef, {
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

export async function getTradeActivityLog(tradeRef: string): Promise<TradeActivityEntry[]> {
  const rows = await prisma.tradeActivity.findMany({
    where: { trade: { tradeRef: tradeRef.trim() } },
    orderBy: { at: "asc" },
  });
  return rows.map(activityRowToEntry);
}

export async function getTradeChangeRequests(tradeRef: string): Promise<ChangeRequest[]> {
  return (await listChangeRequests()).filter(
    (r) => r.entityType === "TRADE" && r.entityRef === tradeRef.trim(),
  );
}

export async function getTradeTimeline(tradeRef: string) {
  const activity = await getTradeActivityLog(tradeRef);
  const changeRequests = await getTradeChangeRequests(tradeRef);
  const pending = changeRequests.filter(
    (r) => r.status === "PENDING" || r.status === "PENDING_CEO",
  );
  return { activity, changeRequests, pending };
}

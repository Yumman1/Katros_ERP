import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { json } from "@/server/db/convert";
import { traderNamesMatch } from "@/lib/trader-identity";

/** Light summary shown on the My Trades "Unfinished" list. */
export type TradeDraftSummary = {
  commodityLabel?: string | null;
  counterpartyLabel?: string | null;
  direction?: string | null;
  quantityLabel?: string | null;
};

export type TradeDraftView = {
  id: string;
  traderName: string;
  payload: Record<string, unknown>;
  summary: TradeDraftSummary | null;
  createdAt: Date;
  updatedAt: Date;
};

function rowToView(row: {
  id: string;
  traderName: string;
  payload: Prisma.JsonValue;
  summary: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): TradeDraftView {
  return {
    id: row.id,
    traderName: row.traderName,
    payload: json<Record<string, unknown>>(row.payload) ?? {},
    summary: json<TradeDraftSummary>(row.summary),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ownedDraft(traderName: string, id: string) {
  const row = await prisma.tradeDraft.findUnique({ where: { id } });
  if (!row || !traderNamesMatch(row.traderName, traderName)) {
    throw new Error("Draft not found");
  }
  return row;
}

/**
 * Autosave the booking form. Passing an id updates that draft; otherwise a
 * new draft is created. Returns the (possibly new) draft id so the client
 * keeps writing to the same row.
 */
export async function upsertTradeDraft(
  traderName: string,
  input: { id?: string | null; payload: Record<string, unknown>; summary?: TradeDraftSummary | null },
): Promise<TradeDraftView> {
  const data = {
    payload: input.payload as Prisma.InputJsonValue,
    summary: (input.summary ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  };
  if (input.id) {
    await ownedDraft(traderName, input.id);
    const row = await prisma.tradeDraft.update({ where: { id: input.id }, data });
    return rowToView(row);
  }
  const row = await prisma.tradeDraft.create({ data: { traderName, ...data } });
  return rowToView(row);
}

/** Unfinished booking drafts for this trader, newest first. */
export async function listTradeDrafts(traderName: string): Promise<TradeDraftView[]> {
  const rows = await prisma.tradeDraft.findMany({ orderBy: { updatedAt: "desc" } });
  return rows.filter((r) => traderNamesMatch(r.traderName, traderName)).map(rowToView);
}

export async function getTradeDraft(traderName: string, id: string): Promise<TradeDraftView> {
  return rowToView(await ownedDraft(traderName, id));
}

/** Delete a draft (discarded, or successfully booked). */
export async function deleteTradeDraft(traderName: string, id: string): Promise<{ ok: true }> {
  await ownedDraft(traderName, id);
  await prisma.tradeDraft.delete({ where: { id } });
  return { ok: true };
}

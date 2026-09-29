import { prisma } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { tradeEntity, internalEntity, type SesameEntity } from "@/lib/sesame-entity";
import { isSesameCommodity } from "@/lib/sesame";

export async function executionDeskTradeRefs(code?: string, db = prisma, entity?: SesameEntity): Promise<string[] | undefined> {
  if (!code) return undefined;
  return (await db.trade.findMany({ where: { commodity: { code } }, select: { tradeRef: true, tradeParams: true } })).filter(t => !entity || !isSesameCommodity(code) || tradeEntity(t.tradeParams) === entity).map(t => t.tradeRef);
}

export function filterDeskRows<T>(rows: T[], code: string | undefined, codeOf: (row: T) => string | null | undefined): T[] {
  return code ? rows.filter(row => codeOf(row) === code) : rows;
}

export async function filterDeskTradeRows<T>(rows: T[], code: string | undefined, refOf: (row: T) => string | null | undefined, entity?: SesameEntity): Promise<T[]> {
  if (!code) return rows;
  const refs = new Set(await executionDeskTradeRefs(code, prisma, entity));
  return rows.filter(row => refs.has(refOf(row) ?? ""));
}

/** Shared master data remains shared; every transaction target must match its desk. */
export async function assertDeskTarget(code: string | undefined, path: string, raw: unknown, entity?: SesameEntity) {
  if (entity === "FZCO" && /(?:StockTransfer|execution\.(?:createPendingTruck|createGateEntry|dailyPrices|setDailyPrice|prices))/.test(path)) throw new TRPCError({ code: "BAD_REQUEST", message: "Physical warehouse operations are managed in the Pakistan desk" });
  if (!code || !raw || typeof raw !== "object") return;
  const input = raw as Record<string, unknown>;
  const reject = () => { throw new TRPCError({ code: "BAD_REQUEST", message: "This record belongs to another commodity or entity. Switch execution desks first." }); };
  if (input.payload && typeof input.payload === "object") await assertDeskTarget(code, path, input.payload, entity);
  if (input.patch && typeof input.patch === "object") await assertDeskTarget(code, path, input.patch, entity);
  if (typeof input.entityRef === "string") {
    if (input.entityType === "TRADE") await assertDeskTarget(code, path, { tradeRef: input.entityRef }, entity);
    if (input.entityType === "GATE_ENTRY") await assertDeskTarget(code, path, { truckId: input.entityRef }, entity);
    if (["INBOUND", "INBOUND_RECEIPT"].includes(String(input.entityType))) await assertDeskTarget(code, path, { receiptId: input.entityRef }, entity);
    if (["OUTBOUND", "OUTBOUND_DISPATCH"].includes(String(input.entityType))) await assertDeskTarget(code, path, { dispatchId: input.entityRef }, entity);
  }
  if (typeof input.id === "string") {
    const key = /(?:update|delete)GateEntry$/.test(path) ? "truckId"
      : /(?:update|delete)InboundReceipt$/.test(path) ? "receiptId"
      : /(?:update|delete)OutboundDispatch$/.test(path) ? "dispatchId" : null;
    if (key) await assertDeskTarget(code, path, { [key]: input.id }, entity);
  }
  if (typeof input.id === "string" && /(?:dispatch|receive|cancel)StockTransfer$/.test(path)) {
    const row = await prisma.stockTransfer.findUnique({ where: { id: input.id }, select: { commodityCode: true } });
    if (row && row.commodityCode !== code) reject();
  }
  if (typeof input.id === "string" && path === "team.resolveChangeRequest") {
    const request = await prisma.changeRequest.findUnique({ where: { id: input.id } });
    if (request) await assertDeskTarget(code, path, { entityType: request.entityType, entityRef: request.entityRef, payload: request.payload }, entity);
  }
  for (const value of [input.commodityCode, path.startsWith("market.") ? input.code : undefined]) {
    if (typeof value === "string" && value !== code) reject();
  }
  if (typeof input.tradeRef === "string" && input.tradeRef.trim()) {
    const row = await prisma.trade.findUnique({ where: { tradeRef: input.tradeRef.trim() }, select: { tradeParams: true, commodity: { select: { code: true } } } });
    if (row && row.commodity.code !== code) reject();
    if (row && entity && isSesameCommodity(code) && tradeEntity(row.tradeParams) !== entity && !(path.startsWith("sesameExecution.") && internalEntity(row.tradeParams) === entity)) reject();
  }
  if (typeof input.truckId === "string") {
    const row = await prisma.pendingTruck.findUnique({ where: { id: input.truckId }, select: { commodityCode: true, executionEntity: true } });
    if (row && row.commodityCode !== code) reject();
    if (row && entity && isSesameCommodity(code) && row.executionEntity !== entity) reject();
  }
  for (const [key, model] of [["receiptId", "inboundReceipt"], ["dispatchId", "outboundDispatch"]] as const) {
    if (typeof input[key] === "string") {
      const args = { where: { id: input[key] as string }, select: { tradeRef: true } } as const;
      const row = model === "inboundReceipt" ? await prisma.inboundReceipt.findUnique(args) : await prisma.outboundDispatch.findUnique(args);
      if (row) await assertDeskTarget(code, path, { tradeRef: row.tradeRef }, entity);
    }
  }
  if (typeof input.noteRef === "string" && input.noteRef.trim()) {
    const note = await prisma.counterpartyLedgerEntry.findFirst({ where: { sourceRef: input.noteRef, counterpartyId: typeof input.counterpartyId === "string" ? input.counterpartyId : undefined, sourceType: "ADJUSTMENT" }, select: { tradeRef: true } });
    if (note) await assertDeskTarget(code, path, { tradeRef: note.tradeRef }, entity);
  }
}

/** Only explicitly attributed advances can contribute to a commodity ledger. */
export async function deskLedgerWhere(code?: string, db: Prisma.TransactionClient = prisma, entity?: SesameEntity): Promise<Prisma.CounterpartyLedgerEntryWhereInput> {
  if (!code) return {};
  const refs = (await db.trade.findMany({ where: { commodity: { code } }, select: { tradeRef: true, tradeParams: true } })).filter(t => !entity || !isSesameCommodity(code) || tradeEntity(t.tradeParams) === entity).map(t => t.tradeRef);
  return { OR: [{ tradeRef: { in: refs } }, { tradeRef: null, voucher: { commodityCode: code, ...(entity ? { executionEntity: entity } : {}) } }] };
}

/** Warehouse master-data requests remain visible in every execution desk. */
export async function filterDeskRequests<T extends { entityType: string; entityRef: string }>(rows: T[], code?: string, entity?: SesameEntity): Promise<T[]> {
  if (!code) return rows;
  const refs = new Set(await executionDeskTradeRefs(code, prisma, entity));
  const [trucks, inbound, outbound] = await Promise.all([
    prisma.pendingTruck.findMany({ where: { commodityCode: code, ...(entity ? { executionEntity: entity } : {}) }, select: { id: true } }),
    prisma.inboundReceipt.findMany({ where: { tradeRef: { in: [...refs] } }, select: { id: true } }),
    prisma.outboundDispatch.findMany({ where: { tradeRef: { in: [...refs] } }, select: { id: true } }),
  ]);
  const ids = new Set([...trucks, ...inbound, ...outbound].map(r => r.id));
  return rows.filter(r => (r.entityType === "WAREHOUSE" && entity !== "FZCO") || refs.has(r.entityRef) || ids.has(r.entityRef));
}

export async function filterDeskRejections<T extends { tradeRef: string | null; voucherNo: string | null; gatepassNo: string | null }>(rows: T[], code?: string, entity?: SesameEntity): Promise<T[]> {
  if (!code) return rows;
  const [refs, vouchers, trucks] = await Promise.all([
    executionDeskTradeRefs(code, prisma, entity),
    prisma.voucher.findMany({ where: { commodityCode: code, ...(entity ? { executionEntity: entity } : {}) }, select: { voucherNo: true } }),
    prisma.pendingTruck.findMany({ where: { commodityCode: code, ...(entity ? { executionEntity: entity } : {}) }, select: { gatepassNo: true } }),
  ]);
  const trades = new Set(refs), v = new Set(vouchers.map(r => r.voucherNo)), t = new Set(trucks.map(r => r.gatepassNo));
  return rows.filter(r => trades.has(r.tradeRef ?? "") || v.has(r.voucherNo ?? "") || t.has(r.gatepassNo ?? ""));
}

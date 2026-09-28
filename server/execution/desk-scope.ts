import { prisma } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";

export async function executionDeskTradeRefs(code?: string, db = prisma): Promise<string[] | undefined> {
  if (!code) return undefined;
  return (await db.trade.findMany({ where: { commodity: { code } }, select: { tradeRef: true } })).map(t => t.tradeRef);
}

export function filterDeskRows<T>(rows: T[], code: string | undefined, codeOf: (row: T) => string | null | undefined): T[] {
  return code ? rows.filter(row => codeOf(row) === code) : rows;
}

export async function filterDeskTradeRows<T>(rows: T[], code: string | undefined, refOf: (row: T) => string | null | undefined): Promise<T[]> {
  if (!code) return rows;
  const refs = new Set(await executionDeskTradeRefs(code));
  return rows.filter(row => refs.has(refOf(row) ?? ""));
}

/** Shared master data remains shared; every transaction target must match its desk. */
export async function assertDeskTarget(code: string | undefined, path: string, raw: unknown) {
  if (!code || !raw || typeof raw !== "object") return;
  const input = raw as Record<string, unknown>;
  const reject = () => { throw new TRPCError({ code: "BAD_REQUEST", message: "This record belongs to another commodity. Switch execution desks first." }); };
  if (input.payload && typeof input.payload === "object") await assertDeskTarget(code, path, input.payload);
  if (input.patch && typeof input.patch === "object") await assertDeskTarget(code, path, input.patch);
  if (typeof input.entityRef === "string") {
    if (input.entityType === "TRADE") await assertDeskTarget(code, path, { tradeRef: input.entityRef });
    if (input.entityType === "GATE_ENTRY") await assertDeskTarget(code, path, { truckId: input.entityRef });
    if (["INBOUND", "INBOUND_RECEIPT"].includes(String(input.entityType))) await assertDeskTarget(code, path, { receiptId: input.entityRef });
    if (["OUTBOUND", "OUTBOUND_DISPATCH"].includes(String(input.entityType))) await assertDeskTarget(code, path, { dispatchId: input.entityRef });
  }
  if (typeof input.id === "string") {
    const key = /(?:update|delete)GateEntry$/.test(path) ? "truckId"
      : /(?:update|delete)InboundReceipt$/.test(path) ? "receiptId"
      : /(?:update|delete)OutboundDispatch$/.test(path) ? "dispatchId" : null;
    if (key) await assertDeskTarget(code, path, { [key]: input.id });
  }
  if (typeof input.id === "string" && /(?:dispatch|receive|cancel)StockTransfer$/.test(path)) {
    const row = await prisma.stockTransfer.findUnique({ where: { id: input.id }, select: { commodityCode: true } });
    if (row && row.commodityCode !== code) reject();
  }
  if (typeof input.id === "string" && path === "team.resolveChangeRequest") {
    const request = await prisma.changeRequest.findUnique({ where: { id: input.id } });
    if (request) await assertDeskTarget(code, path, { entityType: request.entityType, entityRef: request.entityRef, payload: request.payload });
  }
  for (const value of [input.commodityCode, path.startsWith("market.") ? input.code : undefined]) {
    if (typeof value === "string" && value !== code) reject();
  }
  if (typeof input.tradeRef === "string" && input.tradeRef.trim()) {
    const row = await prisma.trade.findUnique({ where: { tradeRef: input.tradeRef.trim() }, select: { commodity: { select: { code: true } } } });
    if (row && row.commodity.code !== code) reject();
  }
  if (typeof input.truckId === "string") {
    const row = await prisma.pendingTruck.findUnique({ where: { id: input.truckId }, select: { commodityCode: true } });
    if (row && row.commodityCode !== code) reject();
  }
  for (const [key, model] of [["receiptId", "inboundReceipt"], ["dispatchId", "outboundDispatch"]] as const) {
    if (typeof input[key] === "string") {
      const args = { where: { id: input[key] as string }, select: { tradeRef: true } } as const;
      const row = model === "inboundReceipt" ? await prisma.inboundReceipt.findUnique(args) : await prisma.outboundDispatch.findUnique(args);
      if (row) await assertDeskTarget(code, path, { tradeRef: row.tradeRef });
    }
  }
  if (typeof input.noteRef === "string" && input.noteRef.trim()) {
    const note = await prisma.counterpartyLedgerEntry.findFirst({ where: { sourceRef: input.noteRef, counterpartyId: typeof input.counterpartyId === "string" ? input.counterpartyId : undefined, sourceType: "ADJUSTMENT" }, select: { tradeRef: true } });
    if (note) await assertDeskTarget(code, path, { tradeRef: note.tradeRef });
  }
}

/** Only explicitly attributed advances can contribute to a commodity ledger. */
export async function deskLedgerWhere(code?: string, db: Prisma.TransactionClient = prisma): Promise<Prisma.CounterpartyLedgerEntryWhereInput> {
  if (!code) return {};
  const refs = (await db.trade.findMany({ where: { commodity: { code } }, select: { tradeRef: true } })).map(t => t.tradeRef);
  return { OR: [{ tradeRef: { in: refs } }, { tradeRef: null, voucher: { commodityCode: code } }] };
}

/** Warehouse master-data requests remain visible in every execution desk. */
export async function filterDeskRequests<T extends { entityType: string; entityRef: string }>(rows: T[], code?: string): Promise<T[]> {
  if (!code) return rows;
  const refs = new Set(await executionDeskTradeRefs(code));
  const [trucks, inbound, outbound] = await Promise.all([
    prisma.pendingTruck.findMany({ where: { commodityCode: code }, select: { id: true } }),
    prisma.inboundReceipt.findMany({ where: { tradeRef: { in: [...refs] } }, select: { id: true } }),
    prisma.outboundDispatch.findMany({ where: { tradeRef: { in: [...refs] } }, select: { id: true } }),
  ]);
  const ids = new Set([...trucks, ...inbound, ...outbound].map(r => r.id));
  return rows.filter(r => r.entityType === "WAREHOUSE" || refs.has(r.entityRef) || ids.has(r.entityRef));
}

export async function filterDeskRejections<T extends { tradeRef: string | null; voucherNo: string | null; gatepassNo: string | null }>(rows: T[], code?: string): Promise<T[]> {
  if (!code) return rows;
  const [refs, vouchers, trucks] = await Promise.all([
    executionDeskTradeRefs(code),
    prisma.voucher.findMany({ where: { commodityCode: code }, select: { voucherNo: true } }),
    prisma.pendingTruck.findMany({ where: { commodityCode: code }, select: { gatepassNo: true } }),
  ]);
  const trades = new Set(refs), v = new Set(vouchers.map(r => r.voucherNo)), t = new Set(trucks.map(r => r.gatepassNo));
  return rows.filter(r => trades.has(r.tradeRef ?? "") || v.has(r.voucherNo ?? "") || t.has(r.gatepassNo ?? ""));
}

import { KG_PER_MAUND } from "@/lib/trade-constants";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import { tradeEntity } from "@/lib/sesame-entity";
import { isSesameCommodity } from "@/lib/sesame";
import { purchaseAdvancePercentage, roundMoney } from "@/lib/purchase-advance";

export async function advanceTrade(tradeRef: string, db: Prisma.TransactionClient = prisma) {
  const trade = await db.trade.findUnique({ where: { tradeRef }, include: { commodity: true } });
  const contract = await db.executionContract.findUnique({ where: { tradeRef } });
  if (!trade || !contract || trade.direction !== "BUY" || trade.directSettled ||
      !["LOCKED", "CONFIRMED"].includes(trade.tradeStatus) ||
      !isSesameCommodity(trade.commodity.code) || tradeEntity(trade.tradeParams) !== "PAK" ||
      (trade.tradeParams as Record<string, unknown> | null)?.internalCounterpartyEntity) {
    throw new Error("Select an open external Pakistan Sesame purchase trade");
  }
  const percentage = purchaseAdvancePercentage(trade.paymentType, trade.tradeParams);
  if (percentage <= 0) throw new Error("This trade has no advance percentage in its payment terms");
  return { trade, percentage, rateKg: num(contract.ratePerKg) || num(contract.ratePerMaund) / KG_PER_MAUND };
}

/** Row locks serialize gate claims, allocation and carry-forward use of a voucher. */
export async function claimAdvance(tx: Prisma.TransactionClient, voucherId: string, truckId: string, tradeRef: string) {
  await tx.$queryRaw`SELECT id FROM "Voucher" WHERE id = ${voucherId} FOR UPDATE`;
  const v = await tx.voucher.findUnique({ where: { id: voucherId }, include: { counterparty: true } });
  const t = await tx.pendingTruck.findUniqueOrThrow({ where: { id: truckId } });
  if (!v || !v.builtyNumber || v.status !== "APPROVED" || v.advanceTruckId || v.tradeRef !== tradeRef ||
      v.executionEntity !== "PAK" || v.side !== "BUY" || v.commodityCode !== t.commodityCode ||
      v.counterparty.name !== t.counterpartyName || (v.truckNo && v.truckNo !== t.truckNo.trim().toUpperCase()) || v.builtyNumber !== t.builtyDetails || t.movementType !== "INBOUND") {
    throw new Error("Select an unused approved advance builty for this supplier and trade");
  }
  await tx.voucher.update({ where: { id: voucherId }, data: { advanceTruckId: truckId } });
}

/** Allocate existing money, never create a second cash/ledger payment. */
export async function applyAdvance(tx: Prisma.TransactionClient, voucherId: string, truckId: string, actor: string, requested?: number) {
  await tx.$queryRaw`SELECT id FROM "PendingTruck" WHERE id = ${truckId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Voucher" WHERE id = ${voucherId} FOR UPDATE`;
  const v = await tx.voucher.findUniqueOrThrow({ where: { id: voucherId }, include: { advanceAllocations: true, advanceTruck: true } });
  const truck = await tx.pendingTruck.findUniqueOrThrow({ where: { id: truckId } });
  const trade = truck.assignedTradeRef ? await tx.trade.findUnique({ where: { tradeRef: truck.assignedTradeRef }, include: { commodity: true } }) : null;
  if (v.status !== "APPROVED" || !v.builtyNumber || !trade || !truck.gateInvoiceNo ||
      trade.counterpartyId !== v.counterpartyId || trade.commodity.code !== v.commodityCode ||
      tradeEntity(trade.tradeParams) !== v.executionEntity || truck.movementType !== "INBOUND") throw new Error("Advance and invoiced truck must belong to the same supplier, commodity and entity");
  const own = v.advanceTruckId === truckId;
  if (truck.gateInvoiceStage === "WRONG_INVOICING" || (!own && truck.gateInvoiceStage === "HOLD_OLD_DUES")) throw new Error("Correct or release the held invoice before applying an advance");
  if (!own) {
    const original = v.advanceTruck?.gatepassNo;
    if (!original || !await tx.inboundReceipt.count({ where: { gatepassNo: original } }) ||
        await tx.inboundReceipt.count({ where: { gatepassNo: original, status: { not: "PAID" } } })) throw new Error("Settle the original truck before carrying its excess forward");
    if (!requested || !Number.isFinite(requested) || requested <= 0) throw new Error("Enter the amount to adjust");
  }
  const available = roundMoney(num(v.amountPkr) - v.advanceAllocations.reduce((s, a) => s + num(a.amountPkr), 0));
  await tx.$queryRaw`SELECT id FROM "InboundReceipt" WHERE "gatepassNo" = ${truck.gatepassNo} ORDER BY id FOR UPDATE`;
  const receipts = await tx.inboundReceipt.findMany({ where: { gatepassNo: truck.gatepassNo }, orderBy: { id: "asc" } });
  const owed = roundMoney(receipts.reduce((s, r) => s + Math.max(0, num(r.amountDue) - num(r.paidAmountPkr)), 0));
  let left = requested == null ? Math.min(available, owed) : roundMoney(requested);
  if (left > available + .005 || left > owed + .005) throw new Error("Adjustment exceeds the available advance or truck balance");
  if (left <= .005) return;
  for (const r of receipts) {
    if (left <= .005) break;
    await tx.$queryRaw`SELECT id FROM "InboundReceipt" WHERE id = ${r.id} FOR UPDATE`;
    if (await tx.paymentRequest.count({ where: { sourceType: "INBOUND", sourceId: r.id, status: "PENDING" } })) throw new Error("Resolve the pending finance payment before adjusting this truck");
    const take = roundMoney(Math.min(left, Math.max(0, num(r.amountDue) - num(r.paidAmountPkr))));
    if (take <= .005) continue;
    await tx.counterpartyLedgerEntry.updateMany({ where: { truckId }, data: { purchaseAdvanceFlow: true, note: `Builty ${truck.builtyDetails} · Invoice ${truck.gateInvoiceNo} · Advance ${v.voucherNo}` } });
    await tx.purchaseAdvanceAllocation.upsert({ where: { voucherId_receiptId: { voucherId, receiptId: r.id } }, create: { voucherId, receiptId: r.id, amountPkr: take, appliedBy: actor }, update: { amountPkr: { increment: take } } });
    const paid = roundMoney(num(r.paidAmountPkr) + take);
    await tx.inboundReceipt.update({ where: { id: r.id }, data: { paidAmountPkr: paid, status: paid + .005 >= num(r.amountDue) ? "PAID" : "PARTIALLY_PAID" } });
    left = roundMoney(left - take);
  }
  const allocations = await tx.purchaseAdvanceAllocation.findMany({
    where: { voucherId },
    include: { receipt: { include: { gatepassTruck: true } } },
  });
  await tx.counterpartyLedgerEntry.updateMany({
    where: { voucherId },
    data: {
      note: [v.note, ...allocations.map(a =>
        `Applied ${num(a.amountPkr)} PKR · ${a.receipt.tradeRef} · Builty ${a.receipt.biltyNo} · Invoice ${a.receipt.gatepassTruck?.gateInvoiceNo ?? a.receipt.billNo ?? "pending"}`,
      )].filter(Boolean).join(" | "),
    },
  });
}

export async function applyTruckAdvance(truckId: string, actor: string) {
  const v = await prisma.voucher.findUnique({ where: { advanceTruckId: truckId } });
  if (v) await prisma.$transaction(tx => applyAdvance(tx, v.id, truckId, actor));
}

export async function approvedAdvanceBuiltys() {
  const rows = await prisma.voucher.findMany({ where: { status: "APPROVED", builtyNumber: { not: null }, advanceTruckId: null }, include: { counterparty: { select: { name: true } } } });
  return rows.map(v => ({ id: v.id, tradeRef: v.tradeRef!, builtyNumber: v.builtyNumber!, truckNo: v.truckNo, counterpartyName: v.counterparty.name, commodityCode: v.commodityCode!, transporterName: v.transporterName ?? "", advanceWeightKg: num(v.advanceWeightKg) }));
}

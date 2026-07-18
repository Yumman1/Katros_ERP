import type { Prisma } from "@prisma/client";
import { KG_PER_MAUND, type QualityTolerances } from "@/lib/trade-constants";
import {
  countsAsReleasedOutbound,
  netCommodityStockMt,
} from "@/lib/inventory-stock";
import { suggestFifoAllocation } from "@/lib/fifo-allocation";
import { kgToQuantityUnit, openQtyEpsilon } from "@/lib/unit-conversion";
import { normWarehouseName } from "@/lib/warehouse-allocation";
import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import { COUNTER, nextRef } from "@/server/db/counters";
import {
  INBOUND_INCLUDE,
  OUTBOUND_INCLUDE,
  inboundRowToRuntime,
  outboundRowToRuntime,
  paymentRowToRuntime,
  type InboundReceipt,
  type InboundReceiptStatus,
  type OutboundDispatch,
  type OutboundDispatchStatus,
} from "./runtime";
import {
  assertWithinDeliveryWindow,
  getContractByRef,
  getLockedContracts,
  refreshContract,
} from "./contracts";

function normWarehouse(s: string): string {
  return normWarehouseName(s);
}

export function computeQualityDeduction(
  contract: QualityTolerances,
  actual: QualityTolerances,
): number {
  let ded = 0;
  if (actual.moisturePct > contract.moisturePct) {
    ded += actual.moisturePct - contract.moisturePct;
  }
  if (actual.damagePct > contract.damagePct) ded += actual.damagePct - contract.damagePct;
  if (actual.brokenPct > contract.brokenPct) ded += actual.brokenPct - contract.brokenPct;
  if (actual.fungusPct > contract.fungusPct) ded += actual.fungusPct - contract.fungusPct;
  if (actual.foreignMatterPct > contract.foreignMatterPct) {
    ded += actual.foreignMatterPct - contract.foreignMatterPct;
  }
  return Math.round(ded * 10000) / 10000;
}

export async function suggestInboundFifo(qtyMt: number, sellerCode?: string) {
  const candidates = (await getLockedContracts({ openOnly: true }))
    .filter((c) => c.executionProfile === "PURCHASE_DELIVERED")
    .filter((c) => !sellerCode || c.counterpartyCode === sellerCode)
    .map((c) => ({
      tradeRef: c.tradeRef,
      contractDate: c.contractDate,
      openQtyMt: c.openQtyMt,
      executionProfile: c.executionProfile,
      direction: "BUY" as const,
    }));
  return suggestFifoAllocation(candidates, qtyMt, "PURCHASE_DELIVERED", "BUY");
}

export async function suggestSaleFifo(qtyMt: number) {
  const candidates = (await getLockedContracts({ openOnly: true }))
    .filter((c) => c.executionProfile === "SALE_EX_WAREHOUSE")
    .map((c) => ({
      tradeRef: c.tradeRef,
      contractDate: c.contractDate,
      openQtyMt: c.openQtyMt,
      executionProfile: c.executionProfile,
      direction: "SELL" as const,
    }));
  return suggestFifoAllocation(candidates, qtyMt, "SALE_EX_WAREHOUSE", "SELL");
}

/** gatepassNo is an FK to PendingTruck — only store values that resolve to a gate entry. */
async function resolvableGatepassNo(gatepassNo: string | null | undefined): Promise<string | null> {
  const gp = gatepassNo?.trim();
  if (!gp) return null;
  const truck = await prisma.pendingTruck.findUnique({
    where: { gatepassNo: gp },
    select: { gatepassNo: true },
  });
  return truck?.gatepassNo ?? null;
}

export async function createInboundReceipt(
  input: Omit<
    InboundReceipt,
    "id" | "status" | "paymentRequestId" | "weightDiffKg" | "deductionPct" | "amountDue"
  > & {
    status?: InboundReceiptStatus;
    fifoOverrideReason?: string | null;
    allowOutsideWindow?: boolean;
  },
): Promise<InboundReceipt> {
  const contract = await getContractByRef(input.tradeRef);
  if (!contract) throw new Error("Locked contract not found");
  assertWithinDeliveryWindow(
    contract,
    input.receiveDate ?? new Date(),
    input.allowOutsideWindow ?? false,
  );

  const weightDiffKg = input.weightWarehouseKg - input.weightSpotKg;
  const deductionPct = computeQualityDeduction(contract.qualityTolerances, input.qualityReadings);
  const netKg = input.weightWarehouseKg * (1 - deductionPct / 100);
  const allocatedQtyMt = kgToQuantityUnit(netKg, contract.quantityUnit);
  const rateKg = contract.ratePerKg ?? contract.ratePerMaund! / KG_PER_MAUND;
  const amountDue = netKg * rateKg;

  const row = await prisma.inboundReceipt.create({
    data: {
      kcsNo: input.kcsNo,
      gatepassNo: await resolvableGatepassNo(input.gatepassNo),
      tradeRef: input.tradeRef,
      receiveDate: input.receiveDate,
      truckNo: input.truckNo,
      driverName: input.driverName ?? null,
      driverCnic: input.driverCnic ?? null,
      driverPhone: input.driverPhone ?? null,
      biltyNo: input.biltyNo,
      trnNo: input.trnNo,
      warehouseName: input.warehouseName,
      sellerName: input.sellerName,
      billNo: input.billNo ?? null,
      bags: input.bags ?? null,
      weightSpotKg: input.weightSpotKg,
      weightWarehouseKg: input.weightWarehouseKg,
      weightDiffKg,
      damagePct: input.qualityReadings.damagePct,
      brokenPct: input.qualityReadings.brokenPct,
      fungusPct: input.qualityReadings.fungusPct,
      foreignMatterPct: input.qualityReadings.foreignMatterPct,
      moisturePct: input.qualityReadings.moisturePct,
      deductionPct,
      allocatedQtyMt,
      fifoOverrideReason: input.fifoOverrideReason ?? null,
      amountDue,
      status: input.status ?? "ALLOCATED",
      documentRefs: input.documentRefs ?? [],
      remarks: input.remarks ?? null,
    },
    include: INBOUND_INCLUDE,
  });
  await refreshContract(input.tradeRef);
  return inboundRowToRuntime(row);
}

export async function getInboundReceipts(tradeRef?: string): Promise<InboundReceipt[]> {
  const rows = await prisma.inboundReceipt.findMany({
    where: tradeRef ? { tradeRef } : undefined,
    include: INBOUND_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(inboundRowToRuntime);
}

export async function submitInboundForFinance(receiptId: string) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.inboundReceipt.findUnique({ where: { id: receiptId } });
    if (!r) throw new Error("Receipt not found");
    if (r.status === "PAID") throw new Error("Already paid");
    const contract = await tx.executionContract.findUnique({
      where: { tradeRef: r.tradeRef },
      select: { currency: true },
    });
    const seq = await nextRef(COUNTER.PAYMENT, tx);
    const pr = await tx.paymentRequest.create({
      data: {
        requestRef: `pay-${seq}`,
        sourceType: "INBOUND",
        sourceId: r.id,
        tradeRef: r.tradeRef,
        counterpartyName: r.sellerName,
        amount: r.amountDue,
        currency: contract?.currency ?? "PKR",
        status: "PENDING",
      },
    });
    // Guarded transition — loses against a concurrent approval marking it PAID.
    const updated = await tx.inboundReceipt.updateMany({
      where: { id: receiptId, status: { not: "PAID" } },
      data: { paymentRequestId: pr.id, status: "FINANCE_PENDING" },
    });
    if (updated.count === 0) throw new Error("Already paid");
    const fresh = await tx.inboundReceipt.findUnique({
      where: { id: receiptId },
      include: INBOUND_INCLUDE,
    });
    return { receipt: inboundRowToRuntime(fresh!), paymentRequest: paymentRowToRuntime(pr) };
  });
}

export async function createOutboundDispatch(
  input: Omit<
    OutboundDispatch,
    "id" | "status" | "paymentRequestId" | "amountDue" | "allocatedQtyMt"
  >,
  options?: { status?: OutboundDispatchStatus; allowOutsideWindow?: boolean },
): Promise<OutboundDispatch> {
  const contract = await getContractByRef(input.tradeRef);
  if (!contract) throw new Error("Locked sale contract not found");
  assertWithinDeliveryWindow(
    contract,
    input.dispatchDate ?? new Date(),
    options?.allowOutsideWindow ?? false,
  );
  const allocatedQtyMt = kgToQuantityUnit(input.invoiceWeightKg, contract.quantityUnit);
  const dispatchStatus = options?.status ?? "WEIGHED";
  if (countsAsReleasedOutbound(dispatchStatus)) {
    await assertSufficientOutboundStock(input.warehouseName, contract.commodityCode, allocatedQtyMt);
  }
  const rateKg = contract.ratePerKg ?? contract.ratePerMaund! / KG_PER_MAUND;
  const amountDue = input.invoiceWeightKg * rateKg;
  const row = await prisma.outboundDispatch.create({
    data: {
      gatepassNo: await resolvableGatepassNo(input.gatepassNo),
      tradeRef: input.tradeRef,
      dispatchDate: input.dispatchDate,
      liftedBy: input.liftedBy,
      buyerName: input.buyerName,
      warehouseName: input.warehouseName,
      truckNo: input.truckNo,
      driverName: input.driverName ?? null,
      driverCnic: input.driverCnic ?? null,
      driverPhone: input.driverPhone ?? null,
      dispatchWeightKg: input.dispatchWeightKg,
      invoiceWeightKg: input.invoiceWeightKg,
      fungusPct: input.fungusPct,
      doRef: input.doRef ?? null,
      fifoOverrideReason: input.fifoOverrideReason ?? null,
      allocatedQtyMt,
      amountDue,
      status: dispatchStatus,
      documentRefs: input.documentRefs ?? [],
      remarks: input.remarks ?? null,
    },
    include: OUTBOUND_INCLUDE,
  });
  await refreshContract(input.tradeRef);
  return outboundRowToRuntime(row);
}

export async function getOutboundDispatches(tradeRef?: string): Promise<OutboundDispatch[]> {
  const rows = await prisma.outboundDispatch.findMany({
    where: tradeRef ? { tradeRef } : undefined,
    include: OUTBOUND_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(outboundRowToRuntime);
}

export async function requestOutboundRelease(dispatchId: string) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.outboundDispatch.findUnique({ where: { id: dispatchId } });
    if (!d) throw new Error("Dispatch not found");
    if (d.status === "RELEASED") throw new Error("Already released");
    const contract = await tx.executionContract.findUnique({
      where: { tradeRef: d.tradeRef },
      select: { currency: true },
    });
    const seq = await nextRef(COUNTER.PAYMENT, tx);
    const pr = await tx.paymentRequest.create({
      data: {
        requestRef: `pay-${seq}`,
        sourceType: "OUTBOUND",
        sourceId: d.id,
        tradeRef: d.tradeRef,
        counterpartyName: d.buyerName,
        amount: d.amountDue,
        currency: contract?.currency ?? "PKR",
        status: "PENDING",
      },
    });
    const updated = await tx.outboundDispatch.updateMany({
      where: { id: dispatchId, status: { not: "RELEASED" } },
      data: { paymentRequestId: pr.id, status: "FINANCE_PENDING" },
    });
    if (updated.count === 0) throw new Error("Already released");
    const fresh = await tx.outboundDispatch.findUnique({
      where: { id: dispatchId },
      include: OUTBOUND_INCLUDE,
    });
    return { dispatch: outboundRowToRuntime(fresh!), paymentRequest: paymentRowToRuntime(pr) };
  });
}

export async function releaseOutbound(dispatchId: string, doRef: string): Promise<OutboundDispatch> {
  const d = await prisma.outboundDispatch.findUnique({
    where: { id: dispatchId },
    include: { paymentRequest: { select: { status: true } } },
  });
  if (!d) throw new Error("Dispatch not found");
  if (!d.paymentRequest || d.paymentRequest.status !== "APPROVED") {
    throw new Error("Finance must approve payment before release");
  }
  // Guarded transition — release applies once.
  const updated = await prisma.outboundDispatch.updateMany({
    where: { id: dispatchId, status: { not: "RELEASED" } },
    data: { doRef, status: "RELEASED" },
  });
  if (updated.count === 0) throw new Error("Already released");
  await refreshContract(d.tradeRef);
  const fresh = await prisma.outboundDispatch.findUnique({
    where: { id: dispatchId },
    include: OUTBOUND_INCLUDE,
  });
  return outboundRowToRuntime(fresh!);
}

/** Keep a PENDING payment request's amount in sync with its source receipt. */
async function syncPaymentAmountForInbound(receipt: {
  paymentRequestId: string | null;
  amountDue: Prisma.Decimal | number;
}): Promise<void> {
  if (!receipt.paymentRequestId) return;
  await prisma.paymentRequest.updateMany({
    where: { id: receipt.paymentRequestId, status: "PENDING" },
    data: { amount: receipt.amountDue },
  });
}

async function syncPaymentAmountForOutbound(dispatch: {
  paymentRequestId: string | null;
  amountDue: Prisma.Decimal | number;
}): Promise<void> {
  if (!dispatch.paymentRequestId) return;
  await prisma.paymentRequest.updateMany({
    where: { id: dispatch.paymentRequestId, status: "PENDING" },
    data: { amount: dispatch.amountDue },
  });
}

/** Mirror gatepass-level edits onto pending trucks sharing the same gatepass + truck no. */
async function syncLinkedPendingTrucks(
  gatepassNo: string | null | undefined,
  truckNo: string,
  patch: Partial<{
    warehouseName: string;
    truckNo: string;
    transporterName: string | null;
    transporterPhone: string | null;
    counterpartyName: string;
    builtyDetails: string;
    weightKg: number;
    bags: number | null;
  }>,
): Promise<void> {
  const gp = gatepassNo?.trim();
  if (!gp) return;
  const tn = truckNo.trim().toUpperCase();
  const trucks = await prisma.pendingTruck.findMany({ where: { gatepassNo: gp } });
  for (const truck of trucks) {
    if (truck.truckNo.trim().toUpperCase() !== tn) continue;
    const data: Prisma.PendingTruckUpdateInput = {};
    if (patch.warehouseName != null) data.warehouseName = patch.warehouseName;
    if (patch.truckNo != null) data.truckNo = patch.truckNo.trim().toUpperCase();
    if (patch.transporterName !== undefined) data.transporterName = patch.transporterName;
    if (patch.transporterPhone !== undefined) data.transporterPhone = patch.transporterPhone;
    if (patch.counterpartyName != null) data.counterpartyName = patch.counterpartyName;
    if (patch.builtyDetails != null) data.builtyDetails = patch.builtyDetails;
    if (patch.bags !== undefined) data.quantityBagsBales = patch.bags;
    if (patch.weightKg != null && truck.status !== "ASSIGNED") {
      data.weightKg = patch.weightKg;
      data.remainingKg = patch.weightKg;
    }
    if (Object.keys(data).length) {
      await prisma.pendingTruck.update({ where: { id: truck.id }, data });
    }
  }
}

export async function syncLinkedMovementsFromGatepass(
  gatepassNo: string | null | undefined,
  truckNo: string,
  patch: Partial<{
    warehouseName: string;
    truckNo: string;
    transporterName: string | null;
    transporterPhone: string | null;
    counterpartyName: string;
    builtyDetails: string;
  }>,
): Promise<void> {
  const gp = gatepassNo?.trim();
  if (!gp) return;
  const tn = truckNo.trim().toUpperCase();
  const tradeRefs = new Set<string>();

  const receipts = await prisma.inboundReceipt.findMany({ where: { gatepassNo: gp } });
  for (const r of receipts) {
    if (r.truckNo.trim().toUpperCase() !== tn) continue;
    const data: Prisma.InboundReceiptUpdateInput = {};
    if (patch.warehouseName != null) data.warehouseName = patch.warehouseName;
    if (patch.truckNo != null) data.truckNo = patch.truckNo.trim().toUpperCase();
    if (patch.transporterName !== undefined) data.driverName = patch.transporterName;
    if (patch.transporterPhone !== undefined) data.driverPhone = patch.transporterPhone;
    if (patch.counterpartyName != null) data.sellerName = patch.counterpartyName;
    if (patch.builtyDetails != null) data.biltyNo = patch.builtyDetails;
    if (Object.keys(data).length) {
      await prisma.inboundReceipt.update({ where: { id: r.id }, data });
    }
    tradeRefs.add(r.tradeRef);
    await syncPaymentAmountForInbound(r);
  }

  const dispatches = await prisma.outboundDispatch.findMany({ where: { gatepassNo: gp } });
  for (const d of dispatches) {
    if (d.truckNo.trim().toUpperCase() !== tn) continue;
    const data: Prisma.OutboundDispatchUpdateInput = {};
    if (patch.warehouseName != null) data.warehouseName = patch.warehouseName;
    if (patch.truckNo != null) data.truckNo = patch.truckNo.trim().toUpperCase();
    if (patch.transporterName !== undefined) data.driverName = patch.transporterName;
    if (patch.transporterPhone !== undefined) data.driverPhone = patch.transporterPhone;
    if (patch.counterpartyName != null) {
      data.buyerName = patch.counterpartyName;
      data.liftedBy = patch.transporterName ?? patch.counterpartyName;
    }
    if (Object.keys(data).length) {
      await prisma.outboundDispatch.update({ where: { id: d.id }, data });
    }
    tradeRefs.add(d.tradeRef);
    await syncPaymentAmountForOutbound(d);
  }

  await syncLinkedPendingTrucks(gp, tn, patch);
  for (const ref of tradeRefs) await refreshContract(ref);
}

export async function updateInboundReceipt(
  id: string,
  patch: Partial<{
    gatepassNo: string | null;
    truckNo: string;
    warehouseName: string;
    sellerName: string;
    driverName: string | null;
    driverPhone: string | null;
    biltyNo: string;
    bags: number | null;
    weightSpotKg: number;
    weightWarehouseKg: number;
    remarks: string | null;
  }>,
): Promise<InboundReceipt> {
  const receipt = await prisma.inboundReceipt.findUnique({ where: { id } });
  if (!receipt) throw new Error("Inbound receipt not found");
  const prevGatepass = receipt.gatepassNo;
  const prevTruckNo = receipt.truckNo;
  const contract = await getContractByRef(receipt.tradeRef);
  if (!contract) throw new Error("Locked contract not found");

  const data: Prisma.InboundReceiptUpdateInput = {};
  if (patch.gatepassNo !== undefined) {
    data.gatepassTruck = { disconnect: true };
    const gp = await resolvableGatepassNo(patch.gatepassNo);
    if (gp) data.gatepassTruck = { connect: { gatepassNo: gp } };
  }
  if (patch.truckNo != null) data.truckNo = patch.truckNo.trim().toUpperCase();
  if (patch.warehouseName != null) data.warehouseName = patch.warehouseName.trim();
  if (patch.sellerName != null) data.sellerName = patch.sellerName.trim();
  if (patch.driverName !== undefined) data.driverName = patch.driverName?.trim() || null;
  if (patch.driverPhone !== undefined) data.driverPhone = patch.driverPhone?.trim() || null;
  if (patch.biltyNo != null) data.biltyNo = patch.biltyNo.trim();
  if (patch.bags !== undefined) data.bags = patch.bags;
  if (patch.remarks !== undefined) data.remarks = patch.remarks?.trim() || null;
  if (patch.weightSpotKg != null) data.weightSpotKg = patch.weightSpotKg;
  if (patch.weightWarehouseKg != null) data.weightWarehouseKg = patch.weightWarehouseKg;

  if (patch.weightSpotKg != null || patch.weightWarehouseKg != null) {
    const weightSpotKg = patch.weightSpotKg ?? num(receipt.weightSpotKg);
    const weightWarehouseKg = patch.weightWarehouseKg ?? num(receipt.weightWarehouseKg);
    const deductionPct = num(receipt.deductionPct);
    const netKg = weightWarehouseKg * (1 - deductionPct / 100);
    const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
    data.weightDiffKg = weightWarehouseKg - weightSpotKg;
    data.allocatedQtyMt = kgToQuantityUnit(netKg, contract.quantityUnit);
    data.amountDue = netKg * rateKg;
  }

  const updated = await prisma.inboundReceipt.update({
    where: { id },
    data,
    include: INBOUND_INCLUDE,
  });

  await syncLinkedPendingTrucks(prevGatepass, prevTruckNo, {
    warehouseName: updated.warehouseName,
    truckNo: updated.truckNo,
    transporterName: updated.driverName,
    transporterPhone: updated.driverPhone,
    counterpartyName: updated.sellerName,
    builtyDetails: updated.biltyNo,
    weightKg: num(updated.weightWarehouseKg),
    bags: updated.bags,
  });
  await syncPaymentAmountForInbound(updated);
  await refreshContract(updated.tradeRef);
  return inboundRowToRuntime(updated);
}

export async function updateOutboundDispatch(
  id: string,
  patch: Partial<{
    gatepassNo: string | null;
    truckNo: string;
    warehouseName: string;
    buyerName: string;
    liftedBy: string;
    driverName: string | null;
    driverPhone: string | null;
    dispatchWeightKg: number;
    invoiceWeightKg: number;
    doRef: string | null;
    remarks: string | null;
  }>,
): Promise<OutboundDispatch> {
  const dispatch = await prisma.outboundDispatch.findUnique({ where: { id } });
  if (!dispatch) throw new Error("Outbound dispatch not found");
  const prevGatepass = dispatch.gatepassNo;
  const prevTruckNo = dispatch.truckNo;
  const contract = await getContractByRef(dispatch.tradeRef);
  if (!contract) throw new Error("Locked contract not found");

  const data: Prisma.OutboundDispatchUpdateInput = {};
  if (patch.gatepassNo !== undefined) {
    data.gatepassTruck = { disconnect: true };
    const gp = await resolvableGatepassNo(patch.gatepassNo);
    if (gp) data.gatepassTruck = { connect: { gatepassNo: gp } };
  }
  if (patch.truckNo != null) data.truckNo = patch.truckNo.trim().toUpperCase();
  if (patch.warehouseName != null) data.warehouseName = patch.warehouseName.trim();
  if (patch.buyerName != null) data.buyerName = patch.buyerName.trim();
  if (patch.liftedBy != null) data.liftedBy = patch.liftedBy.trim();
  if (patch.driverName !== undefined) data.driverName = patch.driverName?.trim() || null;
  if (patch.driverPhone !== undefined) data.driverPhone = patch.driverPhone?.trim() || null;
  if (patch.doRef !== undefined) data.doRef = patch.doRef?.trim() || null;
  if (patch.remarks !== undefined) data.remarks = patch.remarks?.trim() || null;
  if (patch.dispatchWeightKg != null) data.dispatchWeightKg = patch.dispatchWeightKg;
  if (patch.invoiceWeightKg != null) data.invoiceWeightKg = patch.invoiceWeightKg;

  let allocatedQtyMt = num(dispatch.allocatedQtyMt);
  if (patch.dispatchWeightKg != null || patch.invoiceWeightKg != null) {
    const weightKg = patch.invoiceWeightKg ?? num(dispatch.invoiceWeightKg);
    const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
    allocatedQtyMt = kgToQuantityUnit(weightKg, contract.quantityUnit);
    data.allocatedQtyMt = allocatedQtyMt;
    data.amountDue = weightKg * rateKg;
  }

  // Validate stock before persisting anything.
  const wh = patch.warehouseName != null ? patch.warehouseName.trim() : dispatch.warehouseName;
  if (countsAsReleasedOutbound(dispatch.status)) {
    await assertSufficientOutboundStock(wh, contract.commodityCode, allocatedQtyMt, {
      dispatchId: dispatch.id,
    });
  }

  const updated = await prisma.outboundDispatch.update({
    where: { id },
    data,
    include: OUTBOUND_INCLUDE,
  });

  await syncLinkedPendingTrucks(prevGatepass, prevTruckNo, {
    warehouseName: updated.warehouseName,
    truckNo: updated.truckNo,
    transporterName: updated.driverName,
    transporterPhone: updated.driverPhone,
    counterpartyName: updated.buyerName,
    weightKg: num(updated.dispatchWeightKg),
  });
  await syncPaymentAmountForOutbound(updated);
  await refreshContract(updated.tradeRef);
  return outboundRowToRuntime(updated);
}

export async function deleteInboundReceipt(id: string): Promise<{ ok: true }> {
  const receipt = await prisma.inboundReceipt.findUnique({ where: { id } });
  if (!receipt) throw new Error("Inbound receipt not found");
  await prisma.inboundReceipt.delete({ where: { id } });
  if (receipt.paymentRequestId) {
    await prisma.paymentRequest.deleteMany({ where: { id: receipt.paymentRequestId } });
  }
  await refreshContract(receipt.tradeRef);
  return { ok: true };
}

export async function deleteOutboundDispatch(id: string): Promise<{ ok: true }> {
  const dispatch = await prisma.outboundDispatch.findUnique({ where: { id } });
  if (!dispatch) throw new Error("Outbound dispatch not found");
  await prisma.outboundDispatch.delete({ where: { id } });
  if (dispatch.paymentRequestId) {
    await prisma.paymentRequest.deleteMany({ where: { id: dispatch.paymentRequestId } });
  }
  await refreshContract(dispatch.tradeRef);
  return { ok: true };
}

async function commodityCodeByTradeRef(): Promise<Map<string, string>> {
  const rows = await prisma.executionContract.findMany({
    select: { tradeRef: true, commodityCode: true },
  });
  return new Map(rows.map((r) => [r.tradeRef, r.commodityCode]));
}

type MovementStockRow = {
  id: string;
  warehouseName: string;
  tradeRef: string;
  allocatedQtyMt: number;
  status: string;
};

async function loadStockMovements(): Promise<{
  inbound: MovementStockRow[];
  outbound: MovementStockRow[];
}> {
  const [inboundRows, outboundRows] = await Promise.all([
    prisma.inboundReceipt.findMany({
      select: { id: true, warehouseName: true, tradeRef: true, allocatedQtyMt: true, status: true },
    }),
    prisma.outboundDispatch.findMany({
      select: { id: true, warehouseName: true, tradeRef: true, allocatedQtyMt: true, status: true },
    }),
  ]);
  return {
    inbound: inboundRows.map((r) => ({ ...r, allocatedQtyMt: num(r.allocatedQtyMt) })),
    outbound: outboundRows.map((d) => ({ ...d, allocatedQtyMt: num(d.allocatedQtyMt) })),
  };
}

export async function getWarehouseCommodityStockMt(
  warehouseName: string,
  commodityCode: string,
  exclude?: { inboundId?: string; outboundId?: string },
): Promise<number> {
  const [{ inbound, outbound }, codeByRef] = await Promise.all([
    loadStockMovements(),
    commodityCodeByTradeRef(),
  ]);
  return netCommodityStockMt(
    warehouseName,
    commodityCode,
    inbound,
    outbound,
    (tradeRef) => codeByRef.get(tradeRef) ?? null,
    exclude,
  );
}

/** Physical stock minus outbound trucks still at gate (not yet assigned). Includes unallocated inbound. */
export async function getAvailableOutboundStockMt(
  warehouseName: string,
  commodityCode: string,
  exclude?: { truckId?: string; dispatchId?: string },
): Promise<number> {
  let available = await getWarehouseCommodityStockMt(warehouseName, commodityCode, {
    outboundId: exclude?.dispatchId,
  });
  const trucks = await prisma.pendingTruck.findMany({
    where: { status: { not: "ASSIGNED" } },
    select: {
      id: true,
      warehouseName: true,
      commodityCode: true,
      movementType: true,
      remainingKg: true,
    },
  });
  for (const t of trucks) {
    if (exclude?.truckId && t.id === exclude.truckId) continue;
    if (normWarehouse(t.warehouseName) !== normWarehouse(warehouseName)) continue;
    if ((t.commodityCode ?? "").trim() !== commodityCode.trim()) continue;
    const qtyMt = kgToQuantityUnit(num(t.remainingKg), "MT");
    if (t.movementType === "INBOUND") available += qtyMt;
    else available -= qtyMt;
  }
  return Math.max(0, available);
}

export async function assertSufficientOutboundStock(
  warehouseName: string,
  commodityCode: string,
  qtyMt: number,
  exclude?: { truckId?: string; dispatchId?: string },
): Promise<void> {
  const available = await getAvailableOutboundStockMt(warehouseName, commodityCode, exclude);
  if (qtyMt > available + openQtyEpsilon("MT")) {
    throw new Error(
      `Insufficient physical stock at ${warehouseName}: only ${available.toFixed(3)} MT of ${commodityCode} available, but ${qtyMt.toFixed(3)} MT requested. Outbound cannot exceed on-hand inventory.`,
    );
  }
}

export async function exportMovementsCsv(filter?: {
  warehouseName?: string;
  commodityCode?: string;
  movementType?: "INBOUND" | "OUTBOUND" | "ALL";
  from?: Date;
  to?: Date;
}): Promise<string> {
  const [trucks, receipts, dispatches, contracts] = await Promise.all([
    prisma.pendingTruck.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.inboundReceipt.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.outboundDispatch.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.executionContract.findMany({
      select: { tradeRef: true, commodityCode: true, currency: true },
    }),
  ]);
  const contractByRef = new Map(contracts.map((c) => [c.tradeRef, c]));
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
  const rows: string[] = [
    "Type,Gatepass No,Invoice No,Date,Truck No,Warehouse,Trade Ref,Commodity,Counterparty,Gross Wt (kg),Net Qty (MT),Invoice Amount,Currency,Status,Transporter,Remarks",
  ];
  const wh = filter?.warehouseName && filter.warehouseName !== "ALL" ? filter.warehouseName : null;
  const cm = filter?.commodityCode && filter.commodityCode !== "ALL" ? filter.commodityCode : null;
  const tp = filter?.movementType && filter.movementType !== "ALL" ? filter.movementType : null;
  const from = filter?.from;
  const to = filter?.to;

  for (const t of trucks) {
    if (t.status === "ASSIGNED") continue;
    if (tp && tp !== t.movementType) continue;
    const d = new Date(t.arrivalDate);
    if (from && d < from) continue;
    if (to && d > to) continue;
    if (wh && t.warehouseName !== wh) continue;
    if (cm && t.commodityCode !== cm) continue;
    const remainingKg = num(t.remainingKg);
    const gateInvoiceQtyMt = t.gateInvoiceQtyMt != null ? num(t.gateInvoiceQtyMt) : null;
    rows.push(
      [
        t.movementType,
        t.gatepassNo,
        t.gateInvoiceNo ?? "",
        fmtDate(d),
        t.truckNo,
        t.warehouseName,
        "—",
        t.commodityCode ?? "-",
        t.counterpartyName,
        remainingKg,
        gateInvoiceQtyMt != null ? gateInvoiceQtyMt.toFixed(3) : (remainingKg / 1000).toFixed(3),
        t.gateInvoiceAmount != null ? num(t.gateInvoiceAmount) : "",
        t.gateInvoiceCurrency ?? "",
        "GATEPASS_PENDING",
        t.transporterName?.trim() || "",
        [t.builtyDetails, t.recordedByName ? `By ${t.recordedByName}` : ""].filter(Boolean).join(" · "),
      ]
        .map(escape)
        .join(","),
    );
  }

  if (!tp || tp === "INBOUND") {
    for (const r of receipts) {
      const d = new Date(r.receiveDate);
      if (from && d < from) continue;
      if (to && d > to) continue;
      if (wh && r.warehouseName !== wh) continue;
      const c = contractByRef.get(r.tradeRef);
      if (cm && c?.commodityCode !== cm) continue;
      rows.push(
        ["INBOUND", r.gatepassNo ?? r.kcsNo, r.billNo ?? "", fmtDate(d), r.truckNo, r.warehouseName, r.tradeRef,
          c?.commodityCode ?? "-", r.sellerName, num(r.weightWarehouseKg), num(r.allocatedQtyMt).toFixed(3),
          num(r.amountDue), c?.currency ?? "", r.status, r.driverName ?? "", r.remarks ?? ""].map(escape).join(","),
      );
    }
  }
  if (!tp || tp === "OUTBOUND") {
    for (const d2 of dispatches) {
      const d = new Date(d2.dispatchDate);
      if (from && d < from) continue;
      if (to && d > to) continue;
      if (wh && d2.warehouseName !== wh) continue;
      const c = contractByRef.get(d2.tradeRef);
      if (cm && c?.commodityCode !== cm) continue;
      rows.push(
        ["OUTBOUND", d2.gatepassNo ?? d2.doRef ?? d2.id, "", fmtDate(d), d2.truckNo, d2.warehouseName, d2.tradeRef,
          c?.commodityCode ?? "-", d2.buyerName, num(d2.dispatchWeightKg), num(d2.allocatedQtyMt).toFixed(3),
          num(d2.amountDue), c?.currency ?? "", d2.status, d2.driverName ?? "", d2.remarks ?? ""].map(escape).join(","),
      );
    }
  }
  return rows.join("\n");
}

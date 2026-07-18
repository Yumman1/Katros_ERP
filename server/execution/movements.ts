import { KG_PER_MAUND, type QualityTolerances } from "@/lib/trade-constants";
import {
  countsAsReleasedOutbound,
  netCommodityStockMt,
} from "@/lib/inventory-stock";
import { suggestFifoAllocation } from "@/lib/fifo-allocation";
import { kgToQuantityUnit, openQtyEpsilon } from "@/lib/unit-conversion";
import { normWarehouseName } from "@/lib/warehouse-allocation";
import {
  type InboundReceipt,
  type InboundReceiptStatus,
  type OutboundDispatch,
  type OutboundDispatchStatus,
  type PaymentRequest,
  syncExecutionFromDisk,
  getExecutionRuntime,
  ex,
  persistExecutionState,
  setBatchRefreshingContracts,
} from "./runtime";
import {
  assertWithinDeliveryWindow,
  getContractByRef,
  getLockedContracts,
  refreshContract,
  syncAllLockedContracts,
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

export function suggestInboundFifo(qtyMt: number, sellerCode?: string) {
  const candidates = getLockedContracts({ openOnly: true })
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

export function suggestSaleFifo(qtyMt: number) {
  const candidates = getLockedContracts({ openOnly: true })
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

export function createInboundReceipt(input: Omit<InboundReceipt, "id" | "status" | "paymentRequestId" | "weightDiffKg" | "deductionPct" | "amountDue"> & {
  status?: InboundReceiptStatus;
  fifoOverrideReason?: string | null;
  allowOutsideWindow?: boolean;
}) {
  const contract = getContractByRef(input.tradeRef);
  if (!contract) throw new Error("Locked contract not found");
  assertWithinDeliveryWindow(contract, input.receiveDate ?? new Date(), input.allowOutsideWindow ?? false);

  const rt = ex();
  rt.inboundSeq += 1;
  const weightDiffKg = input.weightWarehouseKg - input.weightSpotKg;
  const deductionPct = computeQualityDeduction(contract.qualityTolerances, input.qualityReadings);
  const netKg = input.weightWarehouseKg * (1 - deductionPct / 100);
  const allocatedQtyMt = kgToQuantityUnit(netKg, contract.quantityUnit);
  const rateKg = contract.ratePerKg ?? contract.ratePerMaund! / KG_PER_MAUND;
  const amountDue = netKg * rateKg;

  const { allowOutsideWindow: _allowOutsideWindow, ...receiptInput } = input;
  const receipt: InboundReceipt = {
    ...receiptInput,
    id: `kcs-${rt.inboundSeq}`,
    weightDiffKg,
    deductionPct,
    allocatedQtyMt,
    fifoOverrideReason: input.fifoOverrideReason ?? null,
    amountDue,
    status: input.status ?? "ALLOCATED",
    paymentRequestId: null,
  };
  rt.inboundReceipts.unshift(receipt);
  refreshContract(input.tradeRef);
  persistExecutionState();
  return receipt;
}

export function getInboundReceipts(tradeRef?: string) {
  const rt = ex();
  return tradeRef ? rt.inboundReceipts.filter((r) => r.tradeRef === tradeRef) : [...rt.inboundReceipts];
}

export function submitInboundForFinance(receiptId: string) {
  const rt = ex();
  const r = rt.inboundReceipts.find((x) => x.id === receiptId);
  if (!r) throw new Error("Receipt not found");
  if (r.status === "PAID") throw new Error("Already paid");
  rt.paymentSeq += 1;
  const pr: PaymentRequest = {
    id: `pay-${rt.paymentSeq}`,
    sourceType: "INBOUND",
    sourceId: r.id,
    tradeRef: r.tradeRef,
    counterpartyName: r.sellerName,
    amount: r.amountDue,
    currency: getContractByRef(r.tradeRef)?.currency ?? "PKR",
    status: "PENDING",
    financeComment: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date(),
  };
  rt.paymentRequests.push(pr);
  r.paymentRequestId = pr.id;
  r.status = "FINANCE_PENDING";
  persistExecutionState();
  return { receipt: r, paymentRequest: pr };
}

export function createOutboundDispatch(
  input: Omit<OutboundDispatch, "id" | "status" | "paymentRequestId" | "amountDue" | "allocatedQtyMt">,
  options?: { status?: OutboundDispatchStatus; allowOutsideWindow?: boolean },
) {
  const contract = getContractByRef(input.tradeRef);
  if (!contract) throw new Error("Locked sale contract not found");
  assertWithinDeliveryWindow(contract, input.dispatchDate ?? new Date(), options?.allowOutsideWindow ?? false);
  const rt = ex();
  rt.outboundSeq += 1;
  const allocatedQtyMt = kgToQuantityUnit(input.invoiceWeightKg, contract.quantityUnit);
  const dispatchStatus = options?.status ?? "WEIGHED";
  if (countsAsReleasedOutbound(dispatchStatus)) {
    assertSufficientOutboundStock(input.warehouseName, contract.commodityCode, allocatedQtyMt);
  }
  const rateKg = contract.ratePerKg ?? contract.ratePerMaund! / KG_PER_MAUND;
  const amountDue = input.invoiceWeightKg * rateKg;
  const dispatch: OutboundDispatch = {
    ...input,
    id: `out-${rt.outboundSeq}`,
    allocatedQtyMt,
    amountDue,
    status: dispatchStatus,
    paymentRequestId: null,
  };
  rt.outboundDispatches.unshift(dispatch);
  refreshContract(input.tradeRef);
  persistExecutionState();
  return dispatch;
}

export function getOutboundDispatches(tradeRef?: string) {
  const rt = ex();
  return tradeRef ? rt.outboundDispatches.filter((d) => d.tradeRef === tradeRef) : [...rt.outboundDispatches];
}

export function requestOutboundRelease(dispatchId: string) {
  const rt = ex();
  const d = rt.outboundDispatches.find((x) => x.id === dispatchId);
  if (!d) throw new Error("Dispatch not found");
  if (d.status === "RELEASED") throw new Error("Already released");
  rt.paymentSeq += 1;
  const contract = getContractByRef(d.tradeRef);
  const pr: PaymentRequest = {
    id: `pay-${rt.paymentSeq}`,
    sourceType: "OUTBOUND",
    sourceId: d.id,
    tradeRef: d.tradeRef,
    counterpartyName: d.buyerName,
    amount: d.amountDue,
    currency: contract?.currency ?? "PKR",
    status: "PENDING",
    financeComment: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date(),
  };
  rt.paymentRequests.push(pr);
  d.paymentRequestId = pr.id;
  d.status = "FINANCE_PENDING";
  persistExecutionState();
  return { dispatch: d, paymentRequest: pr };
}

export function releaseOutbound(dispatchId: string, doRef: string) {
  const rt = ex();
  const d = rt.outboundDispatches.find((x) => x.id === dispatchId);
  if (!d) throw new Error("Dispatch not found");
  const pr = d.paymentRequestId ? rt.paymentRequests.find((p) => p.id === d.paymentRequestId) : null;
  if (!pr || pr.status !== "APPROVED") {
    throw new Error("Finance must approve payment before release");
  }
  d.doRef = doRef;
  d.status = "RELEASED";
  refreshContract(d.tradeRef);
  persistExecutionState();
  return d;
}

function movementsForGatepass(
  rt: ReturnType<typeof getExecutionRuntime>,
  gatepassNo: string | null | undefined,
  truckNo: string,
) {
  const gp = gatepassNo?.trim();
  if (!gp) return { receipts: [] as InboundReceipt[], dispatches: [] as OutboundDispatch[] };
  const tn = truckNo.trim().toUpperCase();
  return {
    receipts: rt.inboundReceipts.filter(
      (r) => r.gatepassNo === gp && r.truckNo.trim().toUpperCase() === tn,
    ),
    dispatches: rt.outboundDispatches.filter(
      (d) => d.gatepassNo === gp && d.truckNo.trim().toUpperCase() === tn,
    ),
  };
}

function syncLinkedPendingTrucks(
  rt: ReturnType<typeof getExecutionRuntime>,
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
) {
  const { receipts, dispatches } = movementsForGatepass(rt, gatepassNo, truckNo);
  const gp = gatepassNo?.trim();
  if (!gp) return;
  const tn = truckNo.trim().toUpperCase();
  for (const truck of rt.pendingTrucks) {
    if (truck.gatepassNo !== gp || truck.truckNo.trim().toUpperCase() !== tn) continue;
    if (patch.warehouseName != null) truck.warehouseName = patch.warehouseName;
    if (patch.truckNo != null) truck.truckNo = patch.truckNo.trim().toUpperCase();
    if (patch.transporterName !== undefined) truck.transporterName = patch.transporterName;
    if (patch.transporterPhone !== undefined) truck.transporterPhone = patch.transporterPhone;
    if (patch.counterpartyName != null) truck.counterpartyName = patch.counterpartyName;
    if (patch.builtyDetails != null) truck.builtyDetails = patch.builtyDetails;
    if (patch.bags !== undefined) truck.bags = patch.bags;
    if (patch.weightKg != null && truck.status !== "ASSIGNED") {
      truck.weightKg = patch.weightKg;
      truck.remainingKg = patch.weightKg;
    }
  }
  void receipts;
  void dispatches;
}

export function syncLinkedMovementsFromGatepass(
  rt: ReturnType<typeof getExecutionRuntime>,
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
) {
  const tradeRefs = new Set<string>();
  const { receipts, dispatches } = movementsForGatepass(rt, gatepassNo, truckNo);
  for (const r of receipts) {
    if (patch.warehouseName != null) r.warehouseName = patch.warehouseName;
    if (patch.truckNo != null) r.truckNo = patch.truckNo.trim().toUpperCase();
    if (patch.transporterName !== undefined) r.driverName = patch.transporterName;
    if (patch.transporterPhone !== undefined) r.driverPhone = patch.transporterPhone;
    if (patch.counterpartyName != null) r.sellerName = patch.counterpartyName;
    if (patch.builtyDetails != null) r.biltyNo = patch.builtyDetails;
    tradeRefs.add(r.tradeRef);
    syncPaymentAmountForInbound(rt, r);
  }
  for (const d of dispatches) {
    if (patch.warehouseName != null) d.warehouseName = patch.warehouseName;
    if (patch.truckNo != null) d.truckNo = patch.truckNo.trim().toUpperCase();
    if (patch.transporterName !== undefined) d.driverName = patch.transporterName;
    if (patch.transporterPhone !== undefined) d.driverPhone = patch.transporterPhone;
    if (patch.counterpartyName != null) {
      d.buyerName = patch.counterpartyName;
      d.liftedBy = patch.transporterName ?? patch.counterpartyName;
    }
    tradeRefs.add(d.tradeRef);
    syncPaymentAmountForOutbound(rt, d);
  }
  syncLinkedPendingTrucks(rt, gatepassNo, truckNo, patch);
  for (const ref of tradeRefs) refreshContract(ref);
}

function syncPaymentAmountForInbound(rt: ReturnType<typeof getExecutionRuntime>, receipt: InboundReceipt) {
  if (!receipt.paymentRequestId) return;
  const pr = rt.paymentRequests.find((p) => p.id === receipt.paymentRequestId);
  if (pr && pr.status === "PENDING") pr.amount = receipt.amountDue;
}

function syncPaymentAmountForOutbound(rt: ReturnType<typeof getExecutionRuntime>, dispatch: OutboundDispatch) {
  if (!dispatch.paymentRequestId) return;
  const pr = rt.paymentRequests.find((p) => p.id === dispatch.paymentRequestId);
  if (pr && pr.status === "PENDING") pr.amount = dispatch.amountDue;
}

export function updateInboundReceipt(
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
): InboundReceipt {
  syncExecutionFromDisk();
  setBatchRefreshingContracts(true);
  try {
    const rt = getExecutionRuntime();
    const receipt = rt.inboundReceipts.find((r) => r.id === id);
    if (!receipt) throw new Error("Inbound receipt not found");
    const prevGatepass = receipt.gatepassNo;
    const prevTruckNo = receipt.truckNo;
    const contract = getContractByRef(receipt.tradeRef);
    if (!contract) throw new Error("Locked contract not found");

    if (patch.gatepassNo !== undefined) receipt.gatepassNo = patch.gatepassNo?.trim() || null;
    if (patch.truckNo != null) receipt.truckNo = patch.truckNo.trim().toUpperCase();
    if (patch.warehouseName != null) receipt.warehouseName = patch.warehouseName.trim();
    if (patch.sellerName != null) receipt.sellerName = patch.sellerName.trim();
    if (patch.driverName !== undefined) receipt.driverName = patch.driverName?.trim() || null;
    if (patch.driverPhone !== undefined) receipt.driverPhone = patch.driverPhone?.trim() || null;
    if (patch.biltyNo != null) receipt.biltyNo = patch.biltyNo.trim();
    if (patch.bags !== undefined) receipt.bags = patch.bags;
    if (patch.remarks !== undefined) receipt.remarks = patch.remarks?.trim() || null;
    if (patch.weightSpotKg != null) receipt.weightSpotKg = patch.weightSpotKg;
    if (patch.weightWarehouseKg != null) receipt.weightWarehouseKg = patch.weightWarehouseKg;

    if (patch.weightSpotKg != null || patch.weightWarehouseKg != null) {
      receipt.weightDiffKg = receipt.weightWarehouseKg - receipt.weightSpotKg;
      const netKg = receipt.weightWarehouseKg * (1 - receipt.deductionPct / 100);
      receipt.allocatedQtyMt = kgToQuantityUnit(netKg, contract.quantityUnit);
      const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
      receipt.amountDue = netKg * rateKg;
    }

    syncLinkedPendingTrucks(rt, prevGatepass, prevTruckNo, {
      warehouseName: receipt.warehouseName,
      truckNo: receipt.truckNo,
      transporterName: receipt.driverName,
      transporterPhone: receipt.driverPhone,
      counterpartyName: receipt.sellerName,
      builtyDetails: receipt.biltyNo,
      weightKg: receipt.weightWarehouseKg,
      bags: receipt.bags,
    });
    syncPaymentAmountForInbound(rt, receipt);
    refreshContract(receipt.tradeRef);
    persistExecutionState();
    return receipt;
  } finally {
    setBatchRefreshingContracts(false);
  }
}

export function updateOutboundDispatch(
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
): OutboundDispatch {
  syncExecutionFromDisk();
  setBatchRefreshingContracts(true);
  try {
    const rt = getExecutionRuntime();
    const dispatch = rt.outboundDispatches.find((d) => d.id === id);
    if (!dispatch) throw new Error("Outbound dispatch not found");
    const prevGatepass = dispatch.gatepassNo;
    const prevTruckNo = dispatch.truckNo;
    const contract = getContractByRef(dispatch.tradeRef);
    if (!contract) throw new Error("Locked contract not found");

    if (patch.gatepassNo !== undefined) dispatch.gatepassNo = patch.gatepassNo?.trim() || null;
    if (patch.truckNo != null) dispatch.truckNo = patch.truckNo.trim().toUpperCase();
    if (patch.warehouseName != null) dispatch.warehouseName = patch.warehouseName.trim();
    if (patch.buyerName != null) dispatch.buyerName = patch.buyerName.trim();
    if (patch.liftedBy != null) dispatch.liftedBy = patch.liftedBy.trim();
    if (patch.driverName !== undefined) dispatch.driverName = patch.driverName?.trim() || null;
    if (patch.driverPhone !== undefined) dispatch.driverPhone = patch.driverPhone?.trim() || null;
    if (patch.doRef !== undefined) dispatch.doRef = patch.doRef?.trim() || null;
    if (patch.remarks !== undefined) dispatch.remarks = patch.remarks?.trim() || null;
    if (patch.dispatchWeightKg != null) dispatch.dispatchWeightKg = patch.dispatchWeightKg;
    if (patch.invoiceWeightKg != null) dispatch.invoiceWeightKg = patch.invoiceWeightKg;

    if (patch.dispatchWeightKg != null || patch.invoiceWeightKg != null) {
      const weightKg = dispatch.invoiceWeightKg;
      dispatch.allocatedQtyMt = kgToQuantityUnit(weightKg, contract.quantityUnit);
      const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
      dispatch.amountDue = weightKg * rateKg;
    }

    const wh = dispatch.warehouseName;
    const code = contract.commodityCode;
    if (countsAsReleasedOutbound(dispatch.status)) {
      assertSufficientOutboundStock(wh, code, dispatch.allocatedQtyMt, { dispatchId: dispatch.id });
    }

    syncLinkedPendingTrucks(rt, prevGatepass, prevTruckNo, {
      warehouseName: dispatch.warehouseName,
      truckNo: dispatch.truckNo,
      transporterName: dispatch.driverName,
      transporterPhone: dispatch.driverPhone,
      counterpartyName: dispatch.buyerName,
      weightKg: dispatch.dispatchWeightKg,
    });
    syncPaymentAmountForOutbound(rt, dispatch);
    refreshContract(dispatch.tradeRef);
    persistExecutionState();
    return dispatch;
  } finally {
    setBatchRefreshingContracts(false);
  }
}

export function deleteInboundReceipt(id: string): { ok: true } {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  const receipt = rt.inboundReceipts.find((r) => r.id === id);
  if (!receipt) throw new Error("Inbound receipt not found");
  rt.inboundReceipts = rt.inboundReceipts.filter((r) => r.id !== id);
  if (receipt.paymentRequestId) {
    rt.paymentRequests = rt.paymentRequests.filter((p) => p.id !== receipt.paymentRequestId);
  }
  refreshContract(receipt.tradeRef);
  persistExecutionState();
  return { ok: true };
}

export function deleteOutboundDispatch(id: string): { ok: true } {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  const dispatch = rt.outboundDispatches.find((d) => d.id === id);
  if (!dispatch) throw new Error("Outbound dispatch not found");
  rt.outboundDispatches = rt.outboundDispatches.filter((d) => d.id !== id);
  if (dispatch.paymentRequestId) {
    rt.paymentRequests = rt.paymentRequests.filter((p) => p.id !== dispatch.paymentRequestId);
  }
  refreshContract(dispatch.tradeRef);
  persistExecutionState();
  return { ok: true };
}

function commodityCodeForTradeRef(tradeRef: string): string | null {
  syncAllLockedContracts();
  return getExecutionRuntime().contracts.get(tradeRef)?.commodityCode ?? null;
}

export function getWarehouseCommodityStockMt(
  warehouseName: string,
  commodityCode: string,
  exclude?: { inboundId?: string; outboundId?: string },
): number {
  syncExecutionFromDisk();
  syncAllLockedContracts();
  const rt = getExecutionRuntime();
  return netCommodityStockMt(
    warehouseName,
    commodityCode,
    rt.inboundReceipts,
    rt.outboundDispatches,
    commodityCodeForTradeRef,
    exclude,
  );
}

/** Physical stock minus outbound trucks still at gate (not yet assigned). Includes unallocated inbound. */
export function getAvailableOutboundStockMt(
  warehouseName: string,
  commodityCode: string,
  exclude?: { truckId?: string; dispatchId?: string },
): number {
  syncExecutionFromDisk();
  let available = getWarehouseCommodityStockMt(warehouseName, commodityCode, {
    outboundId: exclude?.dispatchId,
  });
  const rt = getExecutionRuntime();
  for (const t of rt.pendingTrucks) {
    if (exclude?.truckId && t.id === exclude.truckId) continue;
    if (normWarehouse(t.warehouseName) !== normWarehouse(warehouseName)) continue;
    if ((t.commodityCode ?? "").trim() !== commodityCode.trim()) continue;
    if (t.status === "ASSIGNED") continue;
    const qtyMt = kgToQuantityUnit(t.remainingKg, "MT");
    if (t.movementType === "INBOUND") available += qtyMt;
    else available -= qtyMt;
  }
  return Math.max(0, available);
}

export function assertSufficientOutboundStock(
  warehouseName: string,
  commodityCode: string,
  qtyMt: number,
  exclude?: { truckId?: string; dispatchId?: string },
): void {
  const available = getAvailableOutboundStockMt(warehouseName, commodityCode, exclude);
  if (qtyMt > available + openQtyEpsilon("MT")) {
    throw new Error(
      `Insufficient physical stock at ${warehouseName}: only ${available.toFixed(3)} MT of ${commodityCode} available, but ${qtyMt.toFixed(3)} MT requested. Outbound cannot exceed on-hand inventory.`,
    );
  }
}

export function exportMovementsCsv(filter?: {
  warehouseName?: string;
  commodityCode?: string;
  movementType?: "INBOUND" | "OUTBOUND" | "ALL";
  from?: Date;
  to?: Date;
}): string {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  const contractByRef = new Map(rt.contracts.entries());
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

  for (const t of rt.pendingTrucks) {
    if (t.status === "ASSIGNED") continue;
    if (tp && tp !== t.movementType) continue;
    const d = new Date(t.arrivalDate);
    if (from && d < from) continue;
    if (to && d > to) continue;
    if (wh && t.warehouseName !== wh) continue;
    if (cm && t.commodityCode !== cm) continue;
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
        t.remainingKg,
        t.gateInvoiceQtyMt != null ? t.gateInvoiceQtyMt.toFixed(3) : (t.remainingKg / 1000).toFixed(3),
        t.gateInvoiceAmount ?? "",
        t.gateInvoiceCurrency ?? "",
        "GATEPASS_PENDING",
        t.transporterName?.trim() || t.driverName?.trim() || "",
        [t.builtyDetails, t.recordedByName ? `By ${t.recordedByName}` : ""].filter(Boolean).join(" · "),
      ]
        .map(escape)
        .join(","),
    );
  }

  if (!tp || tp === "INBOUND") {
    for (const r of rt.inboundReceipts) {
      const d = new Date(r.receiveDate);
      if (from && d < from) continue;
      if (to && d > to) continue;
      if (wh && r.warehouseName !== wh) continue;
      const c = contractByRef.get(r.tradeRef);
      if (cm && c?.commodityCode !== cm) continue;
      rows.push(
        ["INBOUND", r.gatepassNo ?? r.kcsNo, r.billNo ?? "", fmtDate(d), r.truckNo, r.warehouseName, r.tradeRef,
          c?.commodityCode ?? "-", r.sellerName, r.weightWarehouseKg, r.allocatedQtyMt.toFixed(3),
          r.amountDue, c?.currency ?? "", r.status, r.driverName ?? "", r.remarks ?? ""].map(escape).join(","),
      );
    }
  }
  if (!tp || tp === "OUTBOUND") {
    for (const d2 of rt.outboundDispatches) {
      const d = new Date(d2.dispatchDate);
      if (from && d < from) continue;
      if (to && d > to) continue;
      if (wh && d2.warehouseName !== wh) continue;
      const c = contractByRef.get(d2.tradeRef);
      if (cm && c?.commodityCode !== cm) continue;
      rows.push(
        ["OUTBOUND", d2.gatepassNo ?? d2.doRef ?? d2.id, "", fmtDate(d), d2.truckNo, d2.warehouseName, d2.tradeRef,
          c?.commodityCode ?? "-", d2.buyerName, d2.dispatchWeightKg, d2.allocatedQtyMt.toFixed(3),
          d2.amountDue, c?.currency ?? "", d2.status, d2.driverName ?? "", d2.remarks ?? ""].map(escape).join(","),
      );
    }
  }
  return rows.join("\n");
}

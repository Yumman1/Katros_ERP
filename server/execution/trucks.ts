import { KG_PER_MAUND, type QualityTolerances } from "@/lib/trade-constants";
import { kgToQuantityUnit, quantityUnitToKg } from "@/lib/unit-conversion";
import { TradeDirection } from "@prisma/client";
import { filterUploadedGatepassDocuments } from "@/lib/gatepass-documents";
import {
  contractHasWarehouseAllocation,
  contractMatchesWarehouse,
  normWarehouseName,
  resolveWarehouseAllocations,
} from "@/lib/warehouse-allocation";
import {
  type ExecutionContract,
  type ExecutionRuntime,
  type InboundReceipt,
  type OutboundDispatch,
  type PendingTruck,
  type PendingTruckStatus,
  syncExecutionFromDisk,
  getExecutionRuntime,
  ex,
  persistExecutionState,
  setBatchRefreshingContracts,
} from "./runtime";
import {
  assertWithinDeliveryWindow,
  commodityMatchesTruck,
  contractRequiresWarehouse,
  counterpartyMatchesTruck,
  fifoSortContracts,
  getFulfilledQtyForTradeAtWarehouse,
  getLockedContracts,
  getWarehouseAllocationProgress,
  normalizeContract,
  refreshContract,
  syncAllLockedContracts,
} from "./contracts";
import {
  assertSufficientOutboundStock,
  syncLinkedMovementsFromGatepass,
} from "./movements";

export function truckTransporterName(truck: PendingTruck): string | null {
  return truck.transporterName?.trim() || truck.driverName?.trim() || null;
}

export function truckTransporterPhone(truck: PendingTruck): string | null {
  return truck.transporterPhone?.trim() || truck.driverPhone?.trim() || null;
}

export type GatepassCommodityOption = {
  code: string;
  name: string;
};

export type GatepassCounterpartyOption = {
  name: string;
  code: string;
  openTradeCount: number;
  commodities: GatepassCommodityOption[];
};

function pushGatepassCommodity(
  list: GatepassCommodityOption[],
  code: string,
  name: string,
): GatepassCommodityOption[] {
  if (list.some((c) => c.code === code)) return list;
  return [...list, { code, name }].sort((a, b) => a.name.localeCompare(b.name));
}

/** Counterparties on open locked trades at a warehouse — used for warehouse gate in/out. */
export function getLiveCounterpartiesForGatepass(
  movementType: "INBOUND" | "OUTBOUND",
  warehouseName?: string,
): GatepassCounterpartyOption[] {
  syncAllLockedContracts();
  let contracts = getLockedContracts({ openOnly: true, warehouseAllocated: true }).filter((c) => {
    if (movementType === "INBOUND") {
      return c.direction === TradeDirection.BUY && c.executionProfile === "PURCHASE_DELIVERED";
    }
    return c.direction === TradeDirection.SELL && c.executionProfile === "SALE_EX_WAREHOUSE";
  });

  if (warehouseName?.trim()) {
    contracts = contracts.filter((c) => contractMatchesWarehouse(c, warehouseName));
  }

  const map = new Map<string, GatepassCounterpartyOption>();
  for (const c of contracts) {
    const existing = map.get(c.counterpartyName);
    if (existing) {
      existing.openTradeCount += 1;
      existing.commodities = pushGatepassCommodity(
        existing.commodities,
        c.commodityCode,
        c.commodityName,
      );
    } else {
      map.set(c.counterpartyName, {
        name: c.counterpartyName,
        code: c.counterpartyCode,
        openTradeCount: 1,
        commodities: [{ code: c.commodityCode, name: c.commodityName }],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function isAllowedGatepassCommodity(
  movementType: "INBOUND" | "OUTBOUND",
  counterpartyName: string,
  commodityCode: string,
  warehouseName?: string,
): boolean {
  const cp = getLiveCounterpartiesForGatepass(movementType, warehouseName).find(
    (c) => c.name === counterpartyName,
  );
  return cp?.commodities.some((c) => c.code === commodityCode) ?? false;
}

export function isAllowedGatepassCounterparty(
  movementType: "INBOUND" | "OUTBOUND",
  counterpartyName: string,
  warehouseName?: string,
): boolean {
  const name = counterpartyName.trim();
  return getLiveCounterpartiesForGatepass(movementType, warehouseName).some((c) => c.name === name);
}

export function updatePendingTruck(
  id: string,
  patch: Partial<{
    truckNo: string;
    weightKg: number;
    weightAsPerBuiltyKg: number | null;
    bags: number | null;
    quantityBagsBales: number | null;
    warehouseName: string;
    counterpartyName: string;
    transporterName: string | null;
    transporterPhone: string | null;
    builtyDetails: string;
    quantityAsPerBuilty: string | null;
    weighBridgeName: string | null;
    warehouseWeightKg: number | null;
    qualitySpecs: QualityTolerances | null;
    totalDeductionsKg: number | null;
    documentRefs: string[];
    remarks: string | null;
    commodityCode: string;
    commodityName: string;
  }>,
): PendingTruck {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  const truck = rt.pendingTrucks.find((t) => t.id === id);
  if (!truck) throw new Error("Gate entry not found");
  if (truck.status === "ASSIGNED") {
    throw new Error("Cannot edit an assigned gate entry — unassign or request head review");
  }

  if (patch.truckNo != null) truck.truckNo = patch.truckNo.trim().toUpperCase();
  if (patch.counterpartyName != null) truck.counterpartyName = patch.counterpartyName.trim();
  if (patch.warehouseName != null) truck.warehouseName = patch.warehouseName.trim();
  if (patch.transporterName !== undefined) truck.transporterName = patch.transporterName?.trim() || null;
  if (patch.transporterPhone !== undefined) truck.transporterPhone = patch.transporterPhone?.trim() || null;
  if (patch.builtyDetails != null) truck.builtyDetails = patch.builtyDetails.trim();
  if (patch.quantityAsPerBuilty !== undefined) truck.quantityAsPerBuilty = patch.quantityAsPerBuilty?.trim() || null;
  if (patch.weighBridgeName !== undefined) truck.weighBridgeName = patch.weighBridgeName?.trim() || null;
  if (patch.warehouseWeightKg !== undefined) truck.warehouseWeightKg = patch.warehouseWeightKg;
  if (patch.qualitySpecs !== undefined) truck.qualitySpecs = patch.qualitySpecs;
  if (patch.totalDeductionsKg !== undefined) truck.totalDeductionsKg = patch.totalDeductionsKg;
  if (patch.documentRefs !== undefined) truck.documentRefs = patch.documentRefs;
  if (patch.remarks !== undefined) truck.remarks = patch.remarks?.trim() || null;
  if (patch.bags !== undefined) truck.bags = patch.bags;
  if (patch.quantityBagsBales !== undefined) truck.quantityBagsBales = patch.quantityBagsBales;
  if (patch.commodityCode != null) truck.commodityCode = patch.commodityCode.trim();
  if (patch.commodityName != null) truck.commodityName = patch.commodityName.trim();

  if (patch.weightAsPerBuiltyKg !== undefined) {
    if (patch.weightAsPerBuiltyKg != null && patch.weightAsPerBuiltyKg <= 0) {
      throw new Error("Weight as per builty must be positive");
    }
    truck.weightAsPerBuiltyKg = patch.weightAsPerBuiltyKg;
    if (patch.weightAsPerBuiltyKg != null) {
      patch.weightKg = patch.weightAsPerBuiltyKg;
    }
  }

  if (patch.weightKg != null) {
    if (patch.weightKg <= 0) throw new Error("Weight must be positive");
    if (truck.movementType === "OUTBOUND") {
      const qtyMt = kgToQuantityUnit(patch.weightKg, "MT");
      assertSufficientOutboundStock(truck.warehouseName, truck.commodityCode ?? "", qtyMt, {
        truckId: id,
      });
    }
    truck.weightKg = patch.weightKg;
    truck.remainingKg = patch.weightKg;
  }

  if (patch.warehouseName != null || patch.truckNo != null || patch.transporterName !== undefined || patch.transporterPhone !== undefined) {
    syncLinkedMovementsFromGatepass(rt, truck.gatepassNo, truck.truckNo, {
      warehouseName: patch.warehouseName != null ? truck.warehouseName : undefined,
      truckNo: patch.truckNo != null ? truck.truckNo : undefined,
      transporterName: patch.transporterName !== undefined ? truck.transporterName : undefined,
      transporterPhone: patch.transporterPhone !== undefined ? truck.transporterPhone : undefined,
      counterpartyName: patch.counterpartyName != null ? truck.counterpartyName : undefined,
      builtyDetails: patch.builtyDetails != null ? truck.builtyDetails ?? undefined : undefined,
    });
  }

  persistExecutionState();
  return truck;
}

export function deletePendingTruck(id: string): { ok: true } {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  const before = rt.pendingTrucks.length;
  rt.pendingTrucks = rt.pendingTrucks.filter((t) => t.id !== id);
  if (rt.pendingTrucks.length === before) throw new Error("Gate entry not found");
  persistExecutionState();
  return { ok: true };
}

function normWarehouse(s: string): string {
  return normWarehouseName(s);
}

function formatGatepassNo(movementType: "INBOUND" | "OUTBOUND", seq: number): string {
  return `GP-${movementType === "INBOUND" ? "IN" : "OUT"}-${seq.toString().padStart(4, "0")}`;
}

function formatGateInvoiceNo(seq: number): string {
  return `INV-GIN-${seq.toString().padStart(5, "0")}`;
}

export function inboundNetInvoiceWeightKg(
  warehouseWeightKg: number | null | undefined,
  totalDeductionsKg: number | null | undefined,
): number | null {
  if (warehouseWeightKg == null || warehouseWeightKg <= 0) return null;
  const deductions = totalDeductionsKg ?? 0;
  return Math.max(0, Math.round((warehouseWeightKg - deductions) * 100) / 100);
}

function clearInboundGateInvoice(truck: PendingTruck) {
  truck.gateInvoiceNo = null;
  truck.gateInvoiceWeightKg = null;
  truck.gateInvoiceQtyMt = null;
  truck.gateInvoiceAmount = null;
  truck.gateInvoiceCurrency = null;
  truck.gateInvoiceRatePerKg = null;
  truck.gateInvoiceTradeRef = null;
}

/** Remove provisional invoices on trucks that have not been assigned to a trade yet. */
function sanitizeUnassignedGateInvoices(rt: ExecutionRuntime): void {
  let changed = false;
  for (const truck of rt.pendingTrucks) {
    if (truck.movementType !== "INBOUND") continue;
    if (truck.status === "PENDING" && !truck.assignedTradeRef && truck.gateInvoiceNo) {
      clearInboundGateInvoice(truck);
      changed = true;
    }
  }
  if (changed) persistExecutionState();
}

/** Generate gate invoice when an inbound truck is assigned — rate from the assigned trade only. */
function generateInboundGateInvoiceOnAssign(
  truck: PendingTruck,
  contract: ExecutionContract,
  rt: ExecutionRuntime,
): void {
  if (truck.movementType !== "INBOUND") return;
  if (truck.gateInvoiceNo && truck.gateInvoiceTradeRef === contract.tradeRef) return;

  const netKg = inboundNetInvoiceWeightKg(truck.warehouseWeightKg, truck.totalDeductionsKg);
  if (netKg == null) {
    throw new Error(
      "Enter warehouse weight on the gatepass before assignment — invoice uses warehouse weight minus deductions",
    );
  }

  if (!truck.gateInvoiceNo) {
    rt.gateInvoiceSeq += 1;
    truck.gateInvoiceNo = formatGateInvoiceNo(rt.gateInvoiceSeq);
  }

  const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
  truck.gateInvoiceWeightKg = netKg;
  truck.gateInvoiceQtyMt = kgToQuantityUnit(netKg, contract.quantityUnit);
  truck.gateInvoiceAmount = Math.round(netKg * rateKg * 100) / 100;
  truck.gateInvoiceCurrency = contract.currency;
  truck.gateInvoiceRatePerKg = rateKg;
  truck.gateInvoiceTradeRef = contract.tradeRef;
}

/** Next gatepass number that will be assigned (does not consume the sequence). */
export function previewNextGatepassNo(movementType: "INBOUND" | "OUTBOUND"): string {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  return formatGatepassNo(movementType, rt.truckSeq + 1);
}

export function createPendingTruck(input: {
  counterpartyName: string;
  movementType: "INBOUND" | "OUTBOUND";
  warehouseName: string;
  truckNo: string;
  transporterName?: string | null;
  transporterPhone?: string | null;
  builtyDetails: string;
  commodityCode: string;
  commodityName: string;
  recordedByName: string;
  quantityAsPerBuilty?: string | null;
  weightAsPerBuiltyKg?: number | null;
  weighBridgeName?: string | null;
  documentRefs?: string[];
  warehouseWeightKg?: number | null;
  qualitySpecs?: QualityTolerances | null;
  quantityBagsBales?: number | null;
  totalDeductionsKg?: number | null;
  weightKg: number;
  bags?: number | null;
  remarks?: string | null;
  gatepassNo?: string | null;
  arrivalDate?: Date;
}): PendingTruck {
  syncExecutionFromDisk();
  if (input.movementType === "OUTBOUND") {
    const qtyMt = kgToQuantityUnit(input.weightKg, "MT");
    assertSufficientOutboundStock(input.warehouseName, input.commodityCode, qtyMt);
  }
  const rt = getExecutionRuntime();
  rt.truckSeq += 1;
  const id = `truck-${rt.truckSeq}`;
  const gatepassNo =
    input.gatepassNo?.trim() || formatGatepassNo(input.movementType, rt.truckSeq);
  const truck: PendingTruck = {
    id,
    gatepassNo,
    arrivalDate: input.arrivalDate ?? new Date(),
    counterpartyName: input.counterpartyName.trim(),
    brokerName: null,
    movementType: input.movementType,
    warehouseName: input.warehouseName.trim(),
    truckNo: input.truckNo.trim().toUpperCase(),
    transporterName: input.transporterName?.trim() || null,
    transporterPhone: input.transporterPhone?.trim() || null,
    builtyDetails: input.builtyDetails.trim(),
    commodityCode: input.commodityCode.trim(),
    commodityName: input.commodityName.trim(),
    recordedByName: input.recordedByName.trim(),
    quantityAsPerBuilty: input.quantityAsPerBuilty?.trim() || null,
    weightAsPerBuiltyKg: input.weightAsPerBuiltyKg ?? input.weightKg,
    weighBridgeName: input.weighBridgeName?.trim() || null,
    documentRefs: input.documentRefs?.length ? [...input.documentRefs] : [],
    warehouseWeightKg: input.warehouseWeightKg ?? null,
    qualitySpecs: input.qualitySpecs ?? null,
    quantityBagsBales: input.quantityBagsBales ?? input.bags ?? null,
    totalDeductionsKg: input.totalDeductionsKg ?? null,
    weightKg: input.weightKg,
    bags: input.quantityBagsBales ?? input.bags ?? null,
    remarks: input.remarks || null,
    status: "PENDING",
    assignedTradeRef: null,
    assignedAt: null,
    remainingKg: input.weightKg,
  };
  rt.pendingTrucks.unshift(truck);
  persistExecutionState();
  return truck;
}

export function getPendingTrucks(filter?: {
  counterpartyName?: string;
  warehouseName?: string;
  movementType?: "INBOUND" | "OUTBOUND";
  status?: PendingTruckStatus;
  from?: Date;
  to?: Date;
}): PendingTruck[] {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  sanitizeUnassignedGateInvoices(rt);
  let list = [...rt.pendingTrucks];
  if (filter?.counterpartyName) {
    const q = filter.counterpartyName.toLowerCase();
    list = list.filter(
      (t) =>
        t.counterpartyName.toLowerCase().includes(q) ||
        (t.transporterName?.toLowerCase().includes(q) ?? false) ||
        (truckTransporterName(t)?.toLowerCase().includes(q) ?? false),
    );
  }
  if (filter?.warehouseName && filter.warehouseName !== "ALL")
    list = list.filter((t) => t.warehouseName === filter.warehouseName);
  if (filter?.movementType) list = list.filter((t) => t.movementType === filter.movementType);
  if (filter?.status) list = list.filter((t) => t.status === filter.status);
  if (filter?.from) list = list.filter((t) => new Date(t.arrivalDate) >= filter.from!);
  if (filter?.to) list = list.filter((t) => new Date(t.arrivalDate) <= filter.to!);
  return list.sort(
    (a, b) => new Date(b.arrivalDate).getTime() - new Date(a.arrivalDate).getTime(),
  );
}

export function assignTruckToTrade(
  truckId: string,
  tradeRef: string,
  overrideWeightKg?: number,
  allowOutsideWindow = false,
): { truck: PendingTruck; receipt?: InboundReceipt; dispatch?: OutboundDispatch; splitRemainingKg: number } {
  syncExecutionFromDisk();
  setBatchRefreshingContracts(true);
  try {
    const rt = getExecutionRuntime();
    const truck = rt.pendingTrucks.find((t) => t.id === truckId);
    if (!truck) throw new Error("Pending truck not found");
    if (truck.status === "ASSIGNED") throw new Error("Truck already fully assigned");
    if (!rt.contracts.has(tradeRef)) refreshContract(tradeRef);
    const contractRaw = rt.contracts.get(tradeRef);
    if (!contractRaw) throw new Error("Locked contract not found: " + tradeRef);
    const contract = normalizeContract(contractRaw);
    assertWithinDeliveryWindow(contract, truck.arrivalDate ?? new Date(), allowOutsideWindow);
  if (
    truck.movementType === "INBOUND" &&
    contract.executionProfile !== "PURCHASE_DELIVERED" &&
    contract.executionProfile !== "PURCHASE_SPOT"
  ) {
    throw new Error("Inbound trucks can only be assigned to Purchase Delivered or Purchase Spot contracts");
  }
  if (truck.movementType === "OUTBOUND" && contract.executionProfile !== "SALE_EX_WAREHOUSE") {
    throw new Error("Outbound trucks can only be assigned to Sale Ex-Warehouse contracts");
  }
  if (!counterpartyMatchesTruck(truck, contract)) {
    throw new Error(
      `Counterparty mismatch: truck is for "${truck.counterpartyName}" but contract is "${contract.counterpartyName}"`,
    );
  }
  if (!commodityMatchesTruck(truck, contract)) {
    throw new Error(
      `Commodity mismatch: gatepass is "${truck.commodityName ?? truck.commodityCode}" but contract is "${contract.commodityName}"`,
    );
  }
  if (contractRequiresWarehouse(contract)) {
    if (!contractHasWarehouseAllocation(contract)) {
      throw new Error(
        `Trade ${tradeRef} has no warehouse allocated — execution head must assign a warehouse before fulfilment`,
      );
    }
    if (!contractMatchesWarehouse(contract, truck.warehouseName)) {
      throw new Error(
        `Gatepass warehouse "${truck.warehouseName}" is not in the allocated split for ${tradeRef}`,
      );
    }
  }
  const whAllocatedQty = contractRequiresWarehouse(contract)
    ? resolveWarehouseAllocations(contract)
        .filter((a) => normWarehouse(a.warehouseName) === normWarehouse(truck.warehouseName))
        .reduce((s, a) => s + a.qtyMt, 0)
    : contract.contractualQtyMt;
  const whFulfilledQty = contractRequiresWarehouse(contract)
    ? getFulfilledQtyForTradeAtWarehouse(tradeRef, truck.warehouseName, contract.direction)
    : contract.receivedQtyMt;
  const whOpenQty = Math.max(0, whAllocatedQty - whFulfilledQty);
  const tradeOpenKg = quantityUnitToKg(whOpenQty, contract.quantityUnit);
  const requestedKg = overrideWeightKg ?? truck.remainingKg;
  const allocateKg = Math.min(
    requestedKg,
    truck.remainingKg,
    Math.max(tradeOpenKg, 0),
  );
  if (allocateKg <= 0) {
    throw new Error("Nothing to allocate — check truck remaining weight and order open quantity");
  }
  const splitRemainingKg = truck.remainingKg - allocateKg;
  const unit = contract.quantityUnit;

  if (truck.movementType === "INBOUND") {
    generateInboundGateInvoiceOnAssign(truck, contract, rt);
    rt.inboundSeq += 1;
    const netKg = allocateKg;
    const invoiceWeightKg = truck.gateInvoiceWeightKg ?? netKg;
    const allocatedQtyMt =
      truck.gateInvoiceQtyMt ?? kgToQuantityUnit(invoiceWeightKg, contract.quantityUnit);
    const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
    const receipt: InboundReceipt = {
      id: `kcs-${rt.inboundSeq}`,
      gatepassNo: truck.gatepassNo,
      kcsNo: `KCS-${rt.inboundSeq}`,
      receiveDate: truck.arrivalDate,
      truckNo: truck.truckNo,
      driverName: truckTransporterName(truck),
      driverCnic: truck.driverCnic ?? null,
      driverPhone: truckTransporterPhone(truck),
      biltyNo: truck.builtyDetails || "-",
      trnNo: "-",
      warehouseName: truck.warehouseName,
      sellerName: truck.counterpartyName,
      tradeRef,
      billNo: truck.gateInvoiceNo ?? null,
      bags: truck.quantityBagsBales ?? truck.bags ?? null,
      weightSpotKg: truck.weightAsPerBuiltyKg ?? allocateKg,
      weightWarehouseKg: truck.warehouseWeightKg ?? allocateKg,
      weightDiffKg: truck.totalDeductionsKg ?? 0,
      qualityReadings: truck.qualitySpecs ?? contract.qualityTolerances,
      deductionPct: 0,
      allocatedQtyMt,
      fifoOverrideReason: null,
      amountDue: truck.gateInvoiceAmount ?? invoiceWeightKg * rateKg,
      status: "ALLOCATED",
      paymentRequestId: null,
      documentRefs: filterUploadedGatepassDocuments(truck.documentRefs),
      remarks: [
        truck.remarks,
        truck.commodityName ? `Commodity: ${truck.commodityName}` : null,
        truck.weighBridgeName ? `Weigh bridge: ${truck.weighBridgeName}` : null,
        truck.quantityAsPerBuilty ? `Qty per builty: ${truck.quantityAsPerBuilty}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    };
    rt.inboundReceipts.unshift(receipt);
    truck.remainingKg = splitRemainingKg;
    truck.status = splitRemainingKg > 0.5 ? "PARTIAL" : "ASSIGNED";
    truck.assignedTradeRef = tradeRef;
    truck.assignedAt = new Date();
    refreshContract(tradeRef);
    persistExecutionState();
    return { truck, receipt, splitRemainingKg };
  } else {
    rt.outboundSeq += 1;
    const allocatedQtyMt = kgToQuantityUnit(allocateKg, unit);
    assertSufficientOutboundStock(
      truck.warehouseName,
      contract.commodityCode,
      allocatedQtyMt,
      { truckId: truck.id },
    );
    const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
    const dispatch: OutboundDispatch = {
      id: `out-${rt.outboundSeq}`,
      gatepassNo: truck.gatepassNo,
      dispatchDate: truck.arrivalDate,
      liftedBy: truckTransporterName(truck) || truck.counterpartyName,
      buyerName: truck.counterpartyName,
      tradeRef,
      warehouseName: truck.warehouseName,
      truckNo: truck.truckNo,
      driverName: truckTransporterName(truck),
      driverCnic: truck.driverCnic ?? null,
      driverPhone: truckTransporterPhone(truck),
      dispatchWeightKg: allocateKg,
      invoiceWeightKg: allocateKg,
      fungusPct: 0,
      doRef: truck.gatepassNo,
      fifoOverrideReason: null,
      allocatedQtyMt,
      amountDue: allocateKg * rateKg,
      status: "WEIGHED",
      paymentRequestId: null,
      documentRefs: filterUploadedGatepassDocuments(truck.documentRefs),
      remarks: [truck.remarks, truck.commodityName ? `Commodity: ${truck.commodityName}` : null]
        .filter(Boolean)
        .join(" · ") || null,
    };
    rt.outboundDispatches.unshift(dispatch);
    truck.remainingKg = splitRemainingKg;
    truck.status = splitRemainingKg > 0.5 ? "PARTIAL" : "ASSIGNED";
    truck.assignedTradeRef = tradeRef;
    truck.assignedAt = new Date();
    refreshContract(tradeRef);
    persistExecutionState();
    return { truck, dispatch, splitRemainingKg };
  }
  } finally {
    setBatchRefreshingContracts(false);
  }
}

export type TruckFifoAllocation = {
  tradeRef: string;
  qtyKg: number;
  receipt?: InboundReceipt;
  dispatch?: OutboundDispatch;
};

/** Assign truck weight across open FIFO trades for the same counterparty (auto-split overflow). */
export function assignTruckFifoAuto(truckId: string): {
  truck: PendingTruck;
  allocations: TruckFifoAllocation[];
} {
  const rt = ex();
  let truck = rt.pendingTrucks.find((t) => t.id === truckId);
  if (!truck) throw new Error("Pending truck not found");
  if (truck.status === "ASSIGNED") throw new Error("Truck already fully assigned");

  const profile =
    truck.movementType === "INBOUND" ? ("PURCHASE_DELIVERED" as const) : ("SALE_EX_WAREHOUSE" as const);
  const allocations: TruckFifoAllocation[] = [];
  let guard = 0;

  while (truck.remainingKg > 0.5 && truck.status !== "ASSIGNED" && guard < 25) {
    guard += 1;
    syncAllLockedContracts();
    const queue = fifoSortContracts(
      getLockedContracts({
        openOnly: true,
        profile,
        warehouseName: truck!.warehouseName,
      }).filter(
        (c) => counterpartyMatchesTruck(truck!, c) && commodityMatchesTruck(truck!, c),
      ),
    );
    const next = queue.find((c) => {
      const wh = normWarehouse(truck!.warehouseName);
      const line = getWarehouseAllocationProgress(c).find(
        (p) => normWarehouse(p.warehouseName) === wh,
      );
      const whOpen = line?.openQtyMt ?? c.openQtyMt;
      return whOpen > 0.001;
    });
    if (!next) break;

    const beforeKg = truck.remainingKg;
    // Auto-FIFO is an explicit desk action; allow it to fill overdue windows too.
    const result = assignTruckToTrade(truckId, next.tradeRef, undefined, true);
    truck = result.truck;
    const allocatedKg = Math.max(0, beforeKg - result.splitRemainingKg);
    if (allocatedKg < 0.5) break;

    allocations.push({
      tradeRef: next.tradeRef,
      qtyKg: allocatedKg,
      receipt: result.receipt,
      dispatch: result.dispatch,
    });
  }

  if (allocations.length === 0) {
    throw new Error(
      "No open contracts match this truck's counterparty — lock a trade or verify the counterparty name on the gatepass",
    );
  }

  return { truck, allocations };
}

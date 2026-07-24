import { Prisma, TradeDirection, type Role } from "@prisma/client";
import { KG_PER_MAUND, type QualityTolerances } from "@/lib/trade-constants";
import type { GateInvoiceStage } from "@/lib/gate-invoice";
import { traderNamesMatch } from "@/lib/trader-identity";
import { kgToQuantityUnit, quantityUnitToKg } from "@/lib/unit-conversion";
import {
  filterUploadedGatepassDocuments,
  gatepassDocumentDisplayName,
} from "@/lib/gatepass-documents";
import {
  contractHasWarehouseAllocation,
  contractMatchesWarehouse,
  normWarehouseName,
  resolveWarehouseAllocations,
} from "@/lib/warehouse-allocation";
import { prisma } from "@/server/db";
import { num, numOrNull } from "@/server/db/convert";
import { COUNTER, nextRef } from "@/server/db/counters";
import {
  CONTRACT_INCLUDE,
  TRUCK_INCLUDE,
  contractRowToRuntime,
  inboundRowToRuntime,
  outboundRowToRuntime,
  truckRowToRuntime,
  type InboundReceipt,
  type OutboundDispatch,
  type PendingTruck,
  type PendingTruckStatus,
} from "./runtime";
import {
  assertWithinDeliveryWindow,
  commodityMatchesTruck,
  contractRequiresWarehouse,
  counterpartyMatchesTruck,
  fifoSortContracts,
  fulfilledQtyForTradeAtWarehouseDb,
  getLockedContracts,
  normalizeContract,
  refreshContract,
  syncAllLockedContracts,
  type ExecutionContractView,
} from "./contracts";
import {
  assertSufficientOutboundStock,
  syncLinkedMovementsFromGatepass,
} from "./movements";
import { advanceTaxOn, advanceTaxRateFor } from "@/lib/finance-policy";
import { getFinancePolicy } from "@/server/finance/policy";
import { postTruckLedgerDebit, removeSaleDebitForTruck } from "@/server/finance/ledger";

/** Credit days from a trade's payment terms (N-day credit), else null. */
export function tradeCreditDays(trade: {
  paymentType: string;
  tradeParams: unknown;
}): number | null {
  if (trade.paymentType === "CREDIT_30") return 30;
  if (trade.paymentType !== "CREDIT") return null;
  const params = (trade.tradeParams ?? {}) as Record<string, unknown>;
  const days = Number(params.creditDays);
  return Number.isFinite(days) && days > 0 ? days : null;
}

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
export async function getLiveCounterpartiesForGatepass(
  movementType: "INBOUND" | "OUTBOUND",
  warehouseName?: string,
): Promise<GatepassCounterpartyOption[]> {
  await syncAllLockedContracts();
  // Spot purchases don't use warehouse allocation, so fetch without the
  // allocation filter and apply it only where the profile requires it.
  let contracts = (await getLockedContracts({ openOnly: true })).filter((c) => {
    if (movementType === "INBOUND") {
      return (
        c.direction === TradeDirection.BUY &&
        (c.executionProfile === "PURCHASE_DELIVERED" || c.executionProfile === "PURCHASE_SPOT")
      );
    }
    return c.direction === TradeDirection.SELL && c.executionProfile === "SALE_EX_WAREHOUSE";
  });
  contracts = contracts.filter(
    (c) => c.executionProfile === "PURCHASE_SPOT" || contractHasWarehouseAllocation(c),
  );

  if (warehouseName?.trim()) {
    contracts = contracts.filter(
      (c) =>
        c.executionProfile === "PURCHASE_SPOT" || contractMatchesWarehouse(c, warehouseName),
    );
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

export async function isAllowedGatepassCommodity(
  movementType: "INBOUND" | "OUTBOUND",
  counterpartyName: string,
  commodityCode: string,
  warehouseName?: string,
): Promise<boolean> {
  const cp = (await getLiveCounterpartiesForGatepass(movementType, warehouseName)).find(
    (c) => c.name === counterpartyName,
  );
  return cp?.commodities.some((c) => c.code === commodityCode) ?? false;
}

export async function isAllowedGatepassCounterparty(
  movementType: "INBOUND" | "OUTBOUND",
  counterpartyName: string,
  warehouseName?: string,
): Promise<boolean> {
  const name = counterpartyName.trim();
  return (await getLiveCounterpartiesForGatepass(movementType, warehouseName)).some(
    (c) => c.name === name,
  );
}

/** Reconcile the GatepassDocument rows for a gate entry with a documentRefs list. */
async function writeGatepassDocumentRefs(gatepassNo: string, refs: string[]): Promise<void> {
  const clean = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
  const existing = await prisma.gatepassDocument.findMany({
    where: { gatepassNo },
    select: { id: true, storagePath: true },
  });
  const keep = new Set(clean);
  const removeIds = existing.filter((d) => !keep.has(d.storagePath)).map((d) => d.id);
  if (removeIds.length) {
    await prisma.gatepassDocument.deleteMany({ where: { id: { in: removeIds } } });
  }
  const have = new Set(existing.map((d) => d.storagePath));
  const toCreate = clean.filter((ref) => !have.has(ref));
  if (toCreate.length) {
    await prisma.gatepassDocument.createMany({
      data: toCreate.map((ref) => ({
        gatepassNo,
        fileName: gatepassDocumentDisplayName(ref),
        storagePath: ref,
        mimeType: "application/octet-stream",
        fileSize: 0,
      })),
      skipDuplicates: true,
    });
  }
}

export async function updatePendingTruck(
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
): Promise<PendingTruck> {
  const row = await prisma.pendingTruck.findUnique({ where: { id }, include: TRUCK_INCLUDE });
  if (!row) throw new Error("Gate entry not found");
  if (row.status === "ASSIGNED") {
    throw new Error("Cannot edit an assigned gate entry — unassign or request head review");
  }

  const data: Prisma.PendingTruckUpdateInput = {};
  if (patch.truckNo != null) data.truckNo = patch.truckNo.trim().toUpperCase();
  if (patch.counterpartyName != null) data.counterpartyName = patch.counterpartyName.trim();
  if (patch.warehouseName != null) data.warehouseName = patch.warehouseName.trim();
  if (patch.transporterName !== undefined)
    data.transporterName = patch.transporterName?.trim() || null;
  if (patch.transporterPhone !== undefined)
    data.transporterPhone = patch.transporterPhone?.trim() || null;
  if (patch.builtyDetails != null) data.builtyDetails = patch.builtyDetails.trim();
  if (patch.quantityAsPerBuilty !== undefined)
    data.quantityAsPerBuilty = patch.quantityAsPerBuilty?.trim() || null;
  if (patch.weighBridgeName !== undefined)
    data.weighBridgeName = patch.weighBridgeName?.trim() || null;
  if (patch.warehouseWeightKg !== undefined) data.warehouseWeightKg = patch.warehouseWeightKg;
  if (patch.qualitySpecs !== undefined)
    data.qualitySpecs = (patch.qualitySpecs ?? Prisma.JsonNull) as Prisma.InputJsonValue;
  if (patch.totalDeductionsKg !== undefined) data.totalDeductionsKg = patch.totalDeductionsKg;
  if (patch.remarks !== undefined) data.remarks = patch.remarks?.trim() || null;
  if (patch.bags !== undefined) data.quantityBagsBales = patch.bags;
  if (patch.quantityBagsBales !== undefined) data.quantityBagsBales = patch.quantityBagsBales;
  if (patch.commodityCode != null) data.commodityCode = patch.commodityCode.trim();
  if (patch.commodityName != null) data.commodityName = patch.commodityName.trim();

  let weightKgPatch = patch.weightKg;
  if (patch.weightAsPerBuiltyKg !== undefined) {
    if (patch.weightAsPerBuiltyKg != null && patch.weightAsPerBuiltyKg <= 0) {
      throw new Error("Weight as per builty must be positive");
    }
    data.weightAsPerBuiltyKg = patch.weightAsPerBuiltyKg;
    if (patch.weightAsPerBuiltyKg != null) {
      weightKgPatch = patch.weightAsPerBuiltyKg;
    }
  }

  const effectiveWarehouse =
    patch.warehouseName != null ? patch.warehouseName.trim() : row.warehouseName;
  if (weightKgPatch != null) {
    if (weightKgPatch <= 0) throw new Error("Weight must be positive");
    if (row.movementType === "OUTBOUND") {
      const qtyMt = kgToQuantityUnit(weightKgPatch, "MT");
      await assertSufficientOutboundStock(
        effectiveWarehouse,
        (patch.commodityCode != null ? patch.commodityCode.trim() : row.commodityCode) ?? "",
        qtyMt,
        { truckId: id },
      );
    }
    data.weightKg = weightKgPatch;
    data.remainingKg = weightKgPatch;
  }

  const updated = await prisma.pendingTruck.update({ where: { id }, data });

  if (patch.documentRefs !== undefined) {
    await writeGatepassDocumentRefs(updated.gatepassNo, patch.documentRefs);
  }

  if (
    patch.warehouseName != null ||
    patch.truckNo != null ||
    patch.transporterName !== undefined ||
    patch.transporterPhone !== undefined
  ) {
    await syncLinkedMovementsFromGatepass(updated.gatepassNo, updated.truckNo, {
      warehouseName: patch.warehouseName != null ? updated.warehouseName : undefined,
      truckNo: patch.truckNo != null ? updated.truckNo : undefined,
      transporterName: patch.transporterName !== undefined ? updated.transporterName : undefined,
      transporterPhone: patch.transporterPhone !== undefined ? updated.transporterPhone : undefined,
      counterpartyName: patch.counterpartyName != null ? updated.counterpartyName : undefined,
      builtyDetails: patch.builtyDetails != null ? updated.builtyDetails ?? undefined : undefined,
    });
  }

  const fresh = await prisma.pendingTruck.findUnique({ where: { id }, include: TRUCK_INCLUDE });
  return truckRowToRuntime(fresh!);
}

/**
 * Delete a gate entry WITH all its connections: linked receipts/dispatches
 * are removed, affected contracts re-balanced, and ledger debits cleared —
 * never a bare row delete. Blocked once money or goods have actually moved
 * (payment received/settled, released, or a paid receipt).
 */
export async function deletePendingTruck(id: string): Promise<{ ok: true }> {
  const row = await prisma.pendingTruck.findUnique({
    where: { id },
    select: {
      gatepassNo: true,
      saleStage: true,
      saleReleasedAt: true,
      inboundReceipts: { select: { id: true, tradeRef: true, status: true } },
      outboundDispatches: { select: { id: true, tradeRef: true, status: true } },
    },
  });
  if (!row) throw new Error("Gate entry not found");
  if (row.saleReleasedAt || row.saleStage === "PAYMENT_RECEIVED" || row.saleStage === "SETTLED") {
    throw new Error(
      "This truck's payment is already confirmed/released — it can no longer be deleted. Reverse the payment first.",
    );
  }
  if (row.outboundDispatches.some((d) => d.status === "RELEASED")) {
    throw new Error("This truck's dispatch is already released — it can no longer be deleted.");
  }
  if (row.inboundReceipts.some((r) => r.status === "PAID")) {
    throw new Error("This truck's receipt is already paid — it can no longer be deleted.");
  }

  const affectedRefs = [
    ...new Set(
      [...row.inboundReceipts, ...row.outboundDispatches].map((m) => m.tradeRef),
    ),
  ];

  await prisma.$transaction(async (tx) => {
    // Detach pending payment requests raised from these movements.
    const receiptIds = row.inboundReceipts.map((r) => r.id);
    if (receiptIds.length) {
      await tx.paymentRequest.deleteMany({
        where: { sourceType: "INBOUND", sourceId: { in: receiptIds }, status: "PENDING" },
      });
      await tx.inboundReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    }
    const dispatchIds = row.outboundDispatches.map((d) => d.id);
    if (dispatchIds.length) {
      await tx.paymentRequest.deleteMany({
        where: { sourceType: "OUTBOUND", sourceId: { in: dispatchIds }, status: "PENDING" },
      });
      await tx.outboundDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    }
    await removeSaleDebitForTruck(id, tx);
    await tx.pendingTruck.delete({ where: { id } });
  });

  // Re-balance every contract the deleted movements were fulfilling.
  for (const ref of affectedRefs) {
    await refreshContract(ref);
  }
  return { ok: true };
}

function normWarehouse(s: string): string {
  return normWarehouseName(s);
}

function formatGatepassNo(movementType: "INBOUND" | "OUTBOUND", seq: number): string {
  return `GP-${movementType === "INBOUND" ? "IN" : "OUT"}-${seq.toString().padStart(4, "0")}`;
}

function truckCounterName(movementType: "INBOUND" | "OUTBOUND"): string {
  return movementType === "INBOUND" ? COUNTER.TRUCK_INBOUND : COUNTER.TRUCK_OUTBOUND;
}

export function inboundNetInvoiceWeightKg(
  warehouseWeightKg: number | null | undefined,
  totalDeductionsKg: number | null | undefined,
): number | null {
  if (warehouseWeightKg == null || warehouseWeightKg <= 0) return null;
  const deductions = totalDeductionsKg ?? 0;
  return Math.max(0, Math.round((warehouseWeightKg - deductions) * 100) / 100);
}

/**
 * Remove provisional invoices on trucks that have not been assigned to a trade yet.
 * Manually entered invoices always carry a gateInvoiceStage, so only stage-less
 * auto-generated leftovers are cleared — manual entries survive.
 */
async function sanitizeUnassignedGateInvoices(): Promise<void> {
  await prisma.pendingTruck.updateMany({
    where: {
      movementType: "INBOUND",
      status: "PENDING",
      assignedTradeRef: null,
      gateInvoiceNo: { not: null },
      gateInvoiceStage: null,
    },
    data: {
      gateInvoiceNo: null,
      gateInvoiceWeightKg: null,
      gateInvoiceQtyMt: null,
      gateInvoiceAmount: null,
      gateInvoiceCurrency: null,
      gateInvoiceRatePerKg: null,
      gateInvoiceTradeRef: null,
    },
  });
}

/** Next gatepass number that will be assigned (does not consume the sequence). */
export async function previewNextGatepassNo(
  movementType: "INBOUND" | "OUTBOUND",
): Promise<string> {
  const name = truckCounterName(movementType);
  const rows = await prisma.$queryRaw<Array<{ value: bigint }>>`
    SELECT "value" FROM "RefCounter" WHERE "name" = ${name}
  `;
  const next = (rows.length ? Number(rows[0]!.value) : 0) + 1;
  return formatGatepassNo(movementType, next);
}

export async function createPendingTruck(input: {
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
}): Promise<PendingTruck> {
  if (input.movementType === "OUTBOUND") {
    const qtyMt = kgToQuantityUnit(input.weightKg, "MT");
    await assertSufficientOutboundStock(input.warehouseName, input.commodityCode, qtyMt);
  }
  const seq = await nextRef(truckCounterName(input.movementType));
  const gatepassNo = input.gatepassNo?.trim() || formatGatepassNo(input.movementType, seq);
  const row = await prisma.pendingTruck.create({
    data: {
      gatepassNo,
      arrivalDate: input.arrivalDate ?? new Date(),
      counterpartyName: input.counterpartyName.trim(),
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
      warehouseWeightKg: input.warehouseWeightKg ?? null,
      qualitySpecs: (input.qualitySpecs ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      quantityBagsBales: input.quantityBagsBales ?? input.bags ?? null,
      totalDeductionsKg: input.totalDeductionsKg ?? null,
      weightKg: input.weightKg,
      remarks: input.remarks || null,
      status: "PENDING",
      assignedTradeRef: null,
      assignedAt: null,
      remainingKg: input.weightKg,
    },
  });
  if (input.documentRefs?.length) {
    await writeGatepassDocumentRefs(gatepassNo, input.documentRefs);
  }
  const fresh = await prisma.pendingTruck.findUnique({
    where: { id: row.id },
    include: TRUCK_INCLUDE,
  });
  return truckRowToRuntime(fresh!);
}

export async function getPendingTrucks(filter?: {
  counterpartyName?: string;
  warehouseName?: string;
  movementType?: "INBOUND" | "OUTBOUND";
  status?: PendingTruckStatus;
  /**
   * Only trucks whose gate workflow is incomplete. A truck is COMPLETE only when
   * it has an assigned trade AND (for inbound) an entered gate invoice — an
   * assigned-but-uninvoiced inbound truck is still incomplete.
   */
  incompleteOnly?: boolean;
  from?: Date;
  to?: Date;
}): Promise<PendingTruck[]> {
  await sanitizeUnassignedGateInvoices();
  const where: Prisma.PendingTruckWhereInput = {};
  if (filter?.warehouseName && filter.warehouseName !== "ALL") {
    where.warehouseName = filter.warehouseName;
  }
  if (filter?.movementType) where.movementType = filter.movementType;
  if (filter?.status) where.status = filter.status;
  if (filter?.incompleteOnly) {
    where.OR = [
      { status: { not: "ASSIGNED" } },
      { movementType: "INBOUND", gateInvoiceNo: null },
      // Inbound trucks stay in the workflow until the full money pipeline is
      // done: trader approved the invoice AND finance paid the receipt.
      {
        movementType: "INBOUND",
        inboundReceipts: { some: { status: { not: "PAID" } } },
      },
      // Outbound trucks stay in the workflow until execution flips the manual
      // release toggle (printed slips handed to the warehouse manager).
      {
        movementType: "OUTBOUND",
        saleStage: { not: null },
        saleReleasedAt: null,
      },
    ];
  }
  if (filter?.from || filter?.to) {
    where.arrivalDate = {
      ...(filter?.from ? { gte: filter.from } : {}),
      ...(filter?.to ? { lte: filter.to } : {}),
    };
  }
  const rows = await prisma.pendingTruck.findMany({
    where,
    include: TRUCK_INCLUDE,
    orderBy: { arrivalDate: "desc" },
  });
  let list = rows.map(truckRowToRuntime);
  if (filter?.counterpartyName) {
    const q = filter.counterpartyName.toLowerCase();
    list = list.filter(
      (t) =>
        t.counterpartyName.toLowerCase().includes(q) ||
        (t.transporterName?.toLowerCase().includes(q) ?? false) ||
        (truckTransporterName(t)?.toLowerCase().includes(q) ?? false),
    );
  }
  return list;
}

export async function assignTruckToTrade(
  truckId: string,
  tradeRef: string,
  overrideWeightKg?: number,
  allowOutsideWindow = false,
): Promise<{
  truck: PendingTruck;
  receipt?: InboundReceipt;
  dispatch?: OutboundDispatch;
  splitRemainingKg: number;
}> {
  const financePolicy = await getFinancePolicy();
  const result = await prisma.$transaction(async (tx) => {
    // Row locks — two operators cannot double-assign the same truck or race the
    // same contract's open quantity.
    await tx.$queryRaw`SELECT "id" FROM "PendingTruck" WHERE "id" = ${truckId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "ExecutionContract" WHERE "tradeRef" = ${tradeRef} FOR UPDATE`;

    const truckRow = await tx.pendingTruck.findUnique({
      where: { id: truckId },
      include: TRUCK_INCLUDE,
    });
    if (!truckRow) throw new Error("Pending truck not found");
    const truck = truckRowToRuntime(truckRow);
    if (truck.status === "ASSIGNED") throw new Error("Truck already fully assigned");

    const contractRow = await tx.executionContract.findUnique({
      where: { tradeRef },
      include: CONTRACT_INCLUDE,
    });
    if (!contractRow) throw new Error("Locked contract not found: " + tradeRef);
    const contract = normalizeContract(contractRowToRuntime(contractRow));
    assertWithinDeliveryWindow(contract, truck.arrivalDate ?? new Date(), allowOutsideWindow);
    if (
      truck.movementType === "INBOUND" &&
      contract.executionProfile !== "PURCHASE_DELIVERED" &&
      contract.executionProfile !== "PURCHASE_SPOT"
    ) {
      throw new Error(
        "Inbound trucks can only be assigned to Purchase Delivered or Purchase Spot contracts",
      );
    }
    if (truck.movementType === "OUTBOUND" && contract.executionProfile !== "SALE_EX_WAREHOUSE") {
      throw new Error("Outbound trucks can only be assigned to Sale Ex-Warehouse contracts");
    }
    if (!counterpartyMatchesTruck(truck, contract)) {
      throw new Error(
        `Counterparty mismatch: truck is for "${truck.counterpartyName}" but contract is "${contract.counterpartyName}"`,
      );
    }
    // A split truck may only serve multiple trades of the SAME counterparty —
    // its ledger receivable/payable is a single per-truck entry.
    if (truck.assignedTradeRef && truck.assignedTradeRef !== tradeRef) {
      const [prevTrade, nextTrade] = await Promise.all([
        tx.trade.findUnique({
          where: { tradeRef: truck.assignedTradeRef },
          select: { counterpartyId: true },
        }),
        tx.trade.findUnique({ where: { tradeRef }, select: { counterpartyId: true } }),
      ]);
      if (prevTrade && nextTrade && prevTrade.counterpartyId !== nextTrade.counterpartyId) {
        throw new Error(
          `This truck is already partially assigned to a different counterparty's trade (${truck.assignedTradeRef}) — a split truck can only serve trades of the same counterparty`,
        );
      }
    }
    // Once the payment workflow has moved past awaiting-balance, the truck's
    // amounts are locked in — no further assignment.
    if (
      truck.movementType === "OUTBOUND" &&
      truck.saleStage != null &&
      truck.saleStage !== "AWAITING_BALANCE"
    ) {
      throw new Error(
        "This truck's payment workflow is already in progress — it cannot take more assignments",
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
      ? await fulfilledQtyForTradeAtWarehouseDb(tx, tradeRef, truck.warehouseName, contract.direction)
      : contract.receivedQtyMt;
    const whOpenQty = Math.max(0, whAllocatedQty - whFulfilledQty);
    const tradeOpenKg = quantityUnitToKg(whOpenQty, contract.quantityUnit);
    const requestedKg = overrideWeightKg ?? truck.remainingKg;
    const allocateKg = Math.min(requestedKg, truck.remainingKg, Math.max(tradeOpenKg, 0));
    if (allocateKg <= 0) {
      throw new Error("Nothing to allocate — check truck remaining weight and order open quantity");
    }
    const splitRemainingKg = truck.remainingKg - allocateKg;
    const unit = contract.quantityUnit;
    const truckStatus: PendingTruckStatus = splitRemainingKg > 0.5 ? "PARTIAL" : "ASSIGNED";
    const assignedAt = new Date();

    if (truck.movementType === "INBOUND") {
      // No invoice is auto-generated any more. Assignment computes the EXPECTED
      // amount (net warehouse weight × contract rate) as the validation benchmark;
      // the operator enters the physical invoice no/amount afterwards and it is
      // matched against this expectation.
      const invoiceNetKg = inboundNetInvoiceWeightKg(
        truck.warehouseWeightKg,
        truck.totalDeductionsKg,
      );
      if (invoiceNetKg == null) {
        throw new Error(
          "Enter warehouse weight on the gatepass before assignment — invoice uses warehouse weight minus deductions",
        );
      }
      const invoiceRateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
      truck.gateInvoiceExpectedPkr = Math.round(invoiceNetKg * invoiceRateKg * 100) / 100;
      if (!truck.gateInvoiceNo) {
        // Calculation record only — no invoice number, amount, or stage yet.
        truck.gateInvoiceWeightKg = invoiceNetKg;
        truck.gateInvoiceQtyMt = kgToQuantityUnit(invoiceNetKg, contract.quantityUnit);
        truck.gateInvoiceCurrency = contract.currency;
        truck.gateInvoiceRatePerKg = invoiceRateKg;
        truck.gateInvoiceTradeRef = contract.tradeRef;
      } else {
        // Manually entered invoice stays untouched — only backfill the expected
        // amount and re-validate the workflow stage against it.
        truck.gateInvoiceStage = revalidateGateInvoiceStage({
          gateInvoiceAmount: truck.gateInvoiceAmount ?? null,
          gateInvoiceExpectedPkr: truck.gateInvoiceExpectedPkr,
          gateInvoiceStage: truck.gateInvoiceStage ?? null,
        });
      }

      const seq = await nextRef(COUNTER.INBOUND, tx);
      const netKg = allocateKg;
      const invoiceWeightKg = truck.gateInvoiceWeightKg ?? netKg;
      const allocatedQtyMt =
        truck.gateInvoiceQtyMt ?? kgToQuantityUnit(invoiceWeightKg, contract.quantityUnit);
      const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
      const receiptRow = await tx.inboundReceipt.create({
        data: {
          kcsNo: `KCS-${seq}`,
          gatepassNo: truck.gatepassNo,
          tradeRef,
          receiveDate: truck.arrivalDate,
          truckNo: truck.truckNo,
          driverName: truckTransporterName(truck),
          driverCnic: truck.driverCnic ?? null,
          driverPhone: truckTransporterPhone(truck),
          biltyNo: truck.builtyDetails || "-",
          trnNo: "-",
          warehouseName: truck.warehouseName,
          sellerName: truck.counterpartyName,
          billNo: truck.gateInvoiceNo ?? null,
          bags: truck.quantityBagsBales ?? truck.bags ?? null,
          weightSpotKg: truck.weightAsPerBuiltyKg ?? allocateKg,
          weightWarehouseKg: truck.warehouseWeightKg ?? allocateKg,
          weightDiffKg: truck.totalDeductionsKg ?? 0,
          damagePct: (truck.qualitySpecs ?? contract.qualityTolerances).damagePct,
          brokenPct: (truck.qualitySpecs ?? contract.qualityTolerances).brokenPct,
          fungusPct: (truck.qualitySpecs ?? contract.qualityTolerances).fungusPct,
          foreignMatterPct: (truck.qualitySpecs ?? contract.qualityTolerances).foreignMatterPct,
          moisturePct: (truck.qualitySpecs ?? contract.qualityTolerances).moisturePct,
          deductionPct: 0,
          allocatedQtyMt,
          fifoOverrideReason: null,
          amountDue:
            truck.gateInvoiceAmount ?? truck.gateInvoiceExpectedPkr ?? invoiceWeightKg * rateKg,
          status: "ALLOCATED",
          documentRefs: filterUploadedGatepassDocuments(truck.documentRefs),
          remarks:
            [
              truck.remarks,
              truck.commodityName ? `Commodity: ${truck.commodityName}` : null,
              truck.weighBridgeName ? `Weigh bridge: ${truck.weighBridgeName}` : null,
              truck.quantityAsPerBuilty ? `Qty per builty: ${truck.quantityAsPerBuilty}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || null,
        },
        include: { paymentRequest: { select: { requestRef: true } } },
      });

      const updatedTruck = await tx.pendingTruck.update({
        where: { id: truckId },
        data: {
          remainingKg: splitRemainingKg,
          status: truckStatus,
          assignedTradeRef: tradeRef,
          assignedAt,
          gateInvoiceNo: truck.gateInvoiceNo,
          gateInvoiceWeightKg: truck.gateInvoiceWeightKg,
          gateInvoiceQtyMt: truck.gateInvoiceQtyMt,
          gateInvoiceAmount: truck.gateInvoiceAmount,
          gateInvoiceCurrency: truck.gateInvoiceCurrency,
          gateInvoiceRatePerKg: truck.gateInvoiceRatePerKg,
          gateInvoiceTradeRef: truck.gateInvoiceTradeRef,
          // Stage exists only once an invoice has been entered — never for the
          // expected-amount calculation record alone.
          gateInvoiceStage: truck.gateInvoiceNo ? truck.gateInvoiceStage ?? "PENDING_TRADE_APPROVAL" : null,
          gateInvoiceExpectedPkr: truck.gateInvoiceExpectedPkr,
        },
        include: TRUCK_INCLUDE,
      });

      // Buy-side ledger: the expected invoice amount is entered directly on
      // the seller's payables account (payments out credit it later).
      if (truck.gateInvoiceExpectedPkr != null) {
        const tradeRow = await tx.trade.findUnique({
          where: { tradeRef },
          select: { counterpartyId: true, paymentType: true, tradeParams: true },
        });
        if (tradeRow) {
          const creditDays = tradeCreditDays(tradeRow);
          await postTruckLedgerDebit(
            {
              side: "BUY",
              truckId,
              gatepassNo: truck.gatepassNo,
              tradeRef,
              counterpartyId: tradeRow.counterpartyId,
              amountPkr: truck.gateInvoiceExpectedPkr,
              dueDate:
                creditDays != null
                  ? new Date(truck.arrivalDate.getTime() + creditDays * 86_400_000)
                  : null,
              note: `Inbound ${truck.gatepassNo} · ${truck.truckNo} — expected invoice`,
            },
            tx,
          );
        }
      }

      return {
        truck: truckRowToRuntime(updatedTruck),
        receipt: inboundRowToRuntime(receiptRow),
        splitRemainingKg,
      };
    } else {
      const allocatedQtyMt = kgToQuantityUnit(allocateKg, unit);
      await assertSufficientOutboundStock(truck.warehouseName, contract.commodityCode, allocatedQtyMt, {
        truckId: truck.id,
      });
      const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
      const dispatchRow = await tx.outboundDispatch.create({
        data: {
          gatepassNo: truck.gatepassNo,
          tradeRef,
          dispatchDate: truck.arrivalDate,
          liftedBy: truckTransporterName(truck) || truck.counterpartyName,
          buyerName: truck.counterpartyName,
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
          documentRefs: filterUploadedGatepassDocuments(truck.documentRefs),
          remarks:
            [truck.remarks, truck.commodityName ? `Commodity: ${truck.commodityName}` : null]
              .filter(Boolean)
              .join(" · ") || null,
        },
        include: { paymentRequest: { select: { requestRef: true } } },
      });

      // ── Sale payment workflow: receivable = base (weight × rate) + 236G ──
      // advance income tax at the finance-policy rate. Posted as a DEBIT on
      // the buyer's ledger immediately; the truck then waits for enough
      // approved voucher credit before it can be sent for approvals.
      const tradeRow = await tx.trade.findUnique({
        where: { tradeRef },
        select: {
          counterpartyId: true,
          paymentType: true,
          tradeParams: true,
          counterparty: { select: { taxFilerStatus: true } },
        },
      });
      const addedBasePkr = Math.round(allocateKg * rateKg * 100) / 100;
      const saleBasePkr =
        Math.round(((numOrNull(truckRow.saleBasePkr) ?? 0) + addedBasePkr) * 100) / 100;
      // 236G at the buyer's filer/non-filer policy rate.
      const taxRatePct = advanceTaxRateFor(financePolicy, tradeRow?.counterparty.taxFilerStatus);
      const saleTaxPkr = advanceTaxOn(saleBasePkr, taxRatePct);
      const saleExpectedPkr = Math.round((saleBasePkr + saleTaxPkr) * 100) / 100;
      // Keep an already-advanced stage (partial re-assignment); fresh trucks
      // start waiting on ledger balance.
      const saleStage = truckRow.saleStage ?? "AWAITING_BALANCE";

      const updatedTruck = await tx.pendingTruck.update({
        where: { id: truckId },
        data: {
          remainingKg: splitRemainingKg,
          status: truckStatus,
          assignedTradeRef: tradeRef,
          assignedAt,
          saleBasePkr,
          saleTaxPkr,
          saleExpectedPkr,
          saleStage,
        },
        include: TRUCK_INCLUDE,
      });

      if (tradeRow) {
        const creditDays = tradeCreditDays(tradeRow);
        const dueDate =
          creditDays != null
            ? new Date(truck.arrivalDate.getTime() + creditDays * 86_400_000)
            : null;
        await postTruckLedgerDebit(
          {
            side: "SELL",
            truckId,
            gatepassNo: truck.gatepassNo,
            tradeRef,
            counterpartyId: tradeRow.counterpartyId,
            amountPkr: saleExpectedPkr,
            dueDate,
            note: `Outbound ${truck.gatepassNo} · ${truck.truckNo} — incl. 236G ${saleTaxPkr.toLocaleString("en-PK")} PKR`,
          },
          tx,
        );
      }

      return {
        truck: truckRowToRuntime(updatedTruck),
        dispatch: outboundRowToRuntime(dispatchRow),
        splitRemainingKg,
      };
    }
  });

  await refreshContract(tradeRef);
  return result;
}

export type TruckFifoAllocation = {
  tradeRef: string;
  qtyKg: number;
  receipt?: InboundReceipt;
  dispatch?: OutboundDispatch;
};

/** Assign truck weight across open FIFO trades for the same counterparty (auto-split overflow). */
export async function assignTruckFifoAuto(truckId: string): Promise<{
  truck: PendingTruck;
  allocations: TruckFifoAllocation[];
}> {
  const truckRow = await prisma.pendingTruck.findUnique({
    where: { id: truckId },
    include: TRUCK_INCLUDE,
  });
  if (!truckRow) throw new Error("Pending truck not found");
  let truck = truckRowToRuntime(truckRow);
  if (truck.status === "ASSIGNED") throw new Error("Truck already fully assigned");

  const profile =
    truck.movementType === "INBOUND"
      ? ("PURCHASE_DELIVERED" as const)
      : ("SALE_EX_WAREHOUSE" as const);
  const allocations: TruckFifoAllocation[] = [];
  let guard = 0;

  while (truck.remainingKg > 0.5 && truck.status !== "ASSIGNED" && guard < 25) {
    guard += 1;
    const candidates = (
      await getLockedContracts({
        openOnly: true,
        profile,
        warehouseName: truck.warehouseName,
      })
    ).filter((c) => counterpartyMatchesTruck(truck, c) && commodityMatchesTruck(truck, c));
    // fifoSortContracts copies the array but keeps the element references, so the
    // sorted contracts retain their warehouseAllocationProgress views.
    const queue = fifoSortContracts(candidates) as ExecutionContractView[];
    const next = queue.find((c) => {
      const wh = normWarehouse(truck.warehouseName);
      const line = c.warehouseAllocationProgress.find(
        (p) => normWarehouse(p.warehouseName) === wh,
      );
      const whOpen = line?.openQtyMt ?? c.openQtyMt;
      return whOpen > 0.001;
    });
    if (!next) break;

    const beforeKg = truck.remainingKg;
    // Auto-FIFO is an explicit desk action; allow it to fill overdue windows too.
    const result = await assignTruckToTrade(truckId, next.tradeRef, undefined, true);
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

// ─── Gate-invoice workflow ────────────────────────────────────────────────────

/** PKR rounding tolerance when matching an entered invoice against the expected amount. */
export const GATE_INVOICE_MATCH_TOLERANCE_PKR = 1;

/**
 * Re-derive the workflow stage of an entered gate invoice from the expected amount.
 * Match (|entered − expected| ≤ 1 PKR) or unknown expected → PENDING_TRADE_APPROVAL;
 * mismatch → WRONG_INVOICING. A PAYMENT_APPROVED invoice is never downgraded.
 */
export function revalidateGateInvoiceStage(truck: {
  gateInvoiceAmount: number | null;
  gateInvoiceExpectedPkr: number | null;
  gateInvoiceStage: GateInvoiceStage | null;
}): GateInvoiceStage {
  if (truck.gateInvoiceStage === "PAYMENT_APPROVED") return "PAYMENT_APPROVED";
  if (truck.gateInvoiceExpectedPkr == null || truck.gateInvoiceAmount == null) {
    return "PENDING_TRADE_APPROVAL";
  }
  return Math.abs(truck.gateInvoiceAmount - truck.gateInvoiceExpectedPkr) <=
    GATE_INVOICE_MATCH_TOLERANCE_PKR
    ? "PENDING_TRADE_APPROVAL"
    : "WRONG_INVOICING";
}

/**
 * Enter (or edit) the gate invoice on a truck — invoice number + PKR amount,
 * optionally linked to a trade. The amount is validated against the expected
 * amount (net warehouse weight × contract rate, stored at trade assignment):
 * match → PENDING_TRADE_APPROVAL, mismatch → WRONG_INVOICING, unknown expected
 * (no trade yet) → PENDING_TRADE_APPROVAL. Repeated calls update the invoice
 * and re-validate; a PAYMENT_APPROVED invoice cannot be edited without first
 * changing its stage.
 */
export async function setManualGateInvoice(
  truckId: string,
  input: { invoiceNo: string; amountPkr: number; tradeRef?: string | null },
): Promise<PendingTruck> {
  const row = await prisma.pendingTruck.findUnique({ where: { id: truckId } });
  if (!row) throw new Error("Gate entry not found");
  const invoiceNo = input.invoiceNo.trim();
  if (!invoiceNo) throw new Error("Invoice number is required");
  if (!Number.isFinite(input.amountPkr) || input.amountPkr <= 0) {
    throw new Error("Invoice amount must be positive");
  }
  if (row.gateInvoiceNo && row.gateInvoiceStage === "PAYMENT_APPROVED") {
    throw new Error("Invoice already approved by the trader — it can no longer be edited");
  }
  if (row.gateInvoiceNo && row.gateInvoiceStage === "HOLD_OLD_DUES") {
    throw new Error(
      "This invoice is on hold by the trade's trader — only they can release it",
    );
  }
  const tradeRef = input.tradeRef?.trim() || null;
  if (tradeRef) {
    const trade = await prisma.trade.findUnique({ where: { tradeRef }, select: { id: true } });
    if (!trade) throw new Error("Trade not found: " + tradeRef);
  }

  // Expected amount: stored at trade assignment; otherwise computable when the
  // truck is linked to a trade and has a warehouse weighment.
  const effectiveTradeRef = tradeRef ?? row.assignedTradeRef ?? row.gateInvoiceTradeRef;
  let expectedPkr = numOrNull(row.gateInvoiceExpectedPkr);
  if (expectedPkr == null && effectiveTradeRef) {
    const netKg = inboundNetInvoiceWeightKg(
      numOrNull(row.warehouseWeightKg),
      numOrNull(row.totalDeductionsKg),
    );
    const contractRow = await prisma.executionContract.findUnique({
      where: { tradeRef: effectiveTradeRef },
      select: { ratePerKg: true, ratePerMaund: true },
    });
    if (netKg != null && contractRow) {
      const rateKg =
        numOrNull(contractRow.ratePerKg) ?? (numOrNull(contractRow.ratePerMaund) ?? 0) / KG_PER_MAUND;
      if (rateKg > 0) expectedPkr = Math.round(netKg * rateKg * 100) / 100;
    }
  }

  const stage = revalidateGateInvoiceStage({
    gateInvoiceAmount: input.amountPkr,
    gateInvoiceExpectedPkr: expectedPkr,
    // Fresh validation — approved invoices were rejected above.
    gateInvoiceStage: null,
  });

  const updated = await prisma.pendingTruck.update({
    where: { id: truckId },
    data: {
      gateInvoiceNo: invoiceNo,
      gateInvoiceAmount: input.amountPkr,
      gateInvoiceCurrency: "PKR",
      gateInvoiceTradeRef: tradeRef ?? row.gateInvoiceTradeRef,
      gateInvoiceStage: stage,
      gateInvoiceExpectedPkr: expectedPkr,
    },
    include: TRUCK_INCLUDE,
  });
  return truckRowToRuntime(updated);
}

/**
 * Move a truck's gate invoice through the 4-stage workflow.
 *
 * Setting PAYMENT_APPROVED from here is an executive override only (CEO/ADMIN)
 * — the normal approval path is the trade's trader via traderResolveGateInvoice.
 */
export async function setGateInvoiceStage(
  truckId: string,
  stage: GateInvoiceStage,
  opts?: { actorRole?: Role },
): Promise<PendingTruck> {
  // Stage transitions are automatic (validation) or trader decisions
  // (approve / hold from the Invoice approvals page). Execution cannot move
  // stages by hand; the CEO retains an executive override.
  if (opts?.actorRole !== "CEO" && opts?.actorRole !== "ADMIN") {
    throw new Error(
      "Invoice stages are set by validation and the trade's trader — execution cannot change them",
    );
  }
  const row = await prisma.pendingTruck.findUnique({
    where: { id: truckId },
    select: {
      gateInvoiceNo: true,
      gateInvoiceStage: true,
      gateInvoiceAmount: true,
      gateInvoiceExpectedPkr: true,
    },
  });
  if (!row) throw new Error("Gate entry not found");
  if (!row.gateInvoiceNo) {
    throw new Error("This gate entry has no invoice yet — enter or generate one first");
  }
  // Wrong invoicing is a locked state: while the entered amount still
  // mismatches the expected value, the invoice cannot be moved to any other
  // category. The only way out is editing the invoice so the amount matches
  // (which re-validates it back to Pending trade approval).
  if (row.gateInvoiceStage === "WRONG_INVOICING") {
    const amount = row.gateInvoiceAmount != null ? Number(row.gateInvoiceAmount) : null;
    const expected = row.gateInvoiceExpectedPkr != null ? Number(row.gateInvoiceExpectedPkr) : null;
    const stillMismatched =
      amount == null || expected == null || Math.abs(amount - expected) > 1;
    if (stillMismatched) {
      throw new Error(
        "This invoice is flagged as wrong invoicing — edit the invoice amount to match the expected value before changing its stage",
      );
    }
  }
  const updated = await prisma.pendingTruck.update({
    where: { id: truckId },
    data: { gateInvoiceStage: stage },
    include: TRUCK_INCLUDE,
  });
  return truckRowToRuntime(updated);
}

export type GateInvoiceSummaryRow = {
  truckId: string;
  gatepassNo: string;
  invoiceNo: string;
  amount: number;
  /** Expected amount (PKR) from net warehouse weight × contract rate, when known. */
  expectedPkr: number | null;
  currency: string;
  stage: GateInvoiceStage;
  truckNo: string;
};

export type GateInvoiceSummary = {
  /** Σ gateInvoiceAmount over the trade's trucks where stage = PAYMENT_APPROVED. */
  approvedPkr: number;
  /** contractualQtyMt × pricePerCanonicalQty (fallback price) + commission. */
  totalTradeValuePkr: number;
  invoices: GateInvoiceSummaryRow[];
};

/** Approved-vs-total gate-invoice rollup for one trade. */
export async function getGateInvoiceSummary(tradeRef: string): Promise<GateInvoiceSummary> {
  const ref = tradeRef.trim();
  const trade = await prisma.trade.findUnique({
    where: { tradeRef: ref },
    select: {
      quantity: true,
      price: true,
      pricePerCanonicalQty: true,
      commissionAmount: true,
      contract: { select: { contractualQtyMt: true } },
    },
  });
  if (!trade) throw new Error("Trade not found: " + ref);

  const qtyMt = trade.contract ? num(trade.contract.contractualQtyMt) : num(trade.quantity);
  const pricePerQty = numOrNull(trade.pricePerCanonicalQty) ?? num(trade.price);
  const totalTradeValuePkr = qtyMt * pricePerQty + (numOrNull(trade.commissionAmount) ?? 0);

  const rows = await prisma.pendingTruck.findMany({
    where: {
      gateInvoiceNo: { not: null },
      OR: [{ assignedTradeRef: ref }, { gateInvoiceTradeRef: ref }],
    },
    orderBy: { arrivalDate: "asc" },
  });

  const invoices: GateInvoiceSummaryRow[] = rows.map((r) => ({
    truckId: r.id,
    gatepassNo: r.gatepassNo,
    invoiceNo: r.gateInvoiceNo!,
    amount: numOrNull(r.gateInvoiceAmount) ?? 0,
    expectedPkr: numOrNull(r.gateInvoiceExpectedPkr),
    currency: r.gateInvoiceCurrency ?? "PKR",
    stage: r.gateInvoiceStage ?? "PENDING_TRADE_APPROVAL",
    truckNo: r.truckNo,
  }));
  const approvedPkr = invoices.reduce(
    (sum, inv) => (inv.stage === "PAYMENT_APPROVED" ? sum + inv.amount : sum),
    0,
  );

  return { approvedPkr, totalTradeValuePkr, invoices };
}

// ─── Trader invoice approvals ─────────────────────────────────────────────────

/** Gate-invoice stages a trader can act on from the Invoice approvals page. */
export type TraderApprovableStage = Extract<
  GateInvoiceStage,
  "PENDING_TRADE_APPROVAL" | "HOLD_OLD_DUES"
>;

const TRADER_APPROVABLE_STAGES: TraderApprovableStage[] = [
  "PENDING_TRADE_APPROVAL",
  "HOLD_OLD_DUES",
];

/** Thrown when an invoice does not belong to the acting trader's trade (maps to FORBIDDEN). */
export class TraderInvoiceOwnershipError extends Error {}

export type TraderInvoiceApprovalRow = {
  truckId: string;
  gatepassNo: string;
  truckNo: string;
  invoiceNo: string;
  /** Entered gate-invoice amount (PKR). */
  amountPkr: number;
  /** Expected amount (net warehouse weight × contract rate), when known. */
  expectedPkr: number | null;
  stage: TraderApprovableStage;
  warehouseName: string;
  arrivalDate: Date;
  tradeRef: string;
  counterpartyName: string;
  commodityName: string;
  /** trade.quantity × (pricePerCanonicalQty ?? price) + commission. */
  totalTradePricePkr: number;
};

/**
 * Gate invoices awaiting the given trader's decision: entered invoices in
 * PENDING_TRADE_APPROVAL or HOLD_OLD_DUES whose linked trade
 * (assignedTradeRef ?? gateInvoiceTradeRef) belongs to that trader.
 */
export async function getTraderInvoiceApprovals(
  traderName: string,
): Promise<TraderInvoiceApprovalRow[]> {
  const rows = await prisma.pendingTruck.findMany({
    where: {
      gateInvoiceNo: { not: null },
      gateInvoiceStage: { in: TRADER_APPROVABLE_STAGES },
    },
    orderBy: { arrivalDate: "asc" },
  });

  const refs = [
    ...new Set(
      rows
        .map((r) => r.assignedTradeRef ?? r.gateInvoiceTradeRef)
        .filter((ref): ref is string => Boolean(ref)),
    ),
  ];
  if (refs.length === 0) return [];

  const trades = await prisma.trade.findMany({
    where: { tradeRef: { in: refs } },
    select: {
      tradeRef: true,
      traderName: true,
      quantity: true,
      price: true,
      pricePerCanonicalQty: true,
      commissionAmount: true,
      counterparty: { select: { name: true } },
      commodity: { select: { name: true } },
    },
  });
  const tradeByRef = new Map(trades.map((t) => [t.tradeRef, t]));

  const result: TraderInvoiceApprovalRow[] = [];
  for (const r of rows) {
    const tradeRef = r.assignedTradeRef ?? r.gateInvoiceTradeRef;
    if (!tradeRef) continue;
    const trade = tradeByRef.get(tradeRef);
    if (!trade || !traderNamesMatch(trade.traderName, traderName)) continue;
    result.push({
      truckId: r.id,
      gatepassNo: r.gatepassNo,
      truckNo: r.truckNo,
      invoiceNo: r.gateInvoiceNo!,
      amountPkr: numOrNull(r.gateInvoiceAmount) ?? 0,
      expectedPkr: numOrNull(r.gateInvoiceExpectedPkr),
      stage: r.gateInvoiceStage as TraderApprovableStage,
      warehouseName: r.warehouseName,
      arrivalDate: r.arrivalDate,
      tradeRef,
      counterpartyName: trade.counterparty.name,
      commodityName: trade.commodity.name,
      totalTradePricePkr:
        num(trade.quantity) * (numOrNull(trade.pricePerCanonicalQty) ?? num(trade.price)) +
        (numOrNull(trade.commissionAmount) ?? 0),
    });
  }
  return result;
}

/**
 * Trader decision on a gate invoice of one of their own trades:
 * APPROVE → PAYMENT_APPROVED, HOLD → HOLD_OLD_DUES. The invoice must currently
 * be in PENDING_TRADE_APPROVAL or HOLD_OLD_DUES and the linked trade must
 * belong to the acting trader (else TraderInvoiceOwnershipError).
 */
export async function traderResolveGateInvoice(
  traderName: string,
  truckId: string,
  decision: "APPROVE" | "HOLD",
): Promise<PendingTruck> {
  const row = await prisma.pendingTruck.findUnique({ where: { id: truckId } });
  if (!row) throw new Error("Gate entry not found");
  if (!row.gateInvoiceNo) {
    throw new Error("This gate entry has no invoice yet");
  }
  if (
    row.gateInvoiceStage !== "PENDING_TRADE_APPROVAL" &&
    row.gateInvoiceStage !== "HOLD_OLD_DUES"
  ) {
    throw new Error("This invoice is not awaiting trade approval");
  }

  const tradeRef = row.assignedTradeRef ?? row.gateInvoiceTradeRef;
  const trade = tradeRef
    ? await prisma.trade.findUnique({ where: { tradeRef }, select: { traderName: true } })
    : null;
  if (!trade || !traderNamesMatch(trade.traderName, traderName)) {
    throw new TraderInvoiceOwnershipError(
      "This invoice is not linked to one of your trades",
    );
  }

  const stage: GateInvoiceStage = decision === "APPROVE" ? "PAYMENT_APPROVED" : "HOLD_OLD_DUES";
  // Guarded update — only flips the stage if the invoice is still approvable.
  const updated = await prisma.pendingTruck.updateMany({
    where: {
      id: truckId,
      gateInvoiceNo: { not: null },
      gateInvoiceStage: { in: TRADER_APPROVABLE_STAGES },
    },
    data: { gateInvoiceStage: stage },
  });
  if (updated.count === 0) {
    throw new Error("Invoice stage changed in the meantime — refresh and try again");
  }

  // Connected flow: trader approval automatically raises the finance payment
  // request for every allocated receipt of this truck — finance approval then
  // pays it, posts the buy-ledger credit and puts it in the gate register.
  if (decision === "APPROVE") {
    const receipts = await prisma.inboundReceipt.findMany({
      where: { gatepassNo: row.gatepassNo, status: "ALLOCATED" },
      select: { id: true },
    });
    const { submitInboundForFinance } = await import("./movements");
    for (const receipt of receipts) {
      try {
        await submitInboundForFinance(receipt.id);
      } catch {
        // Duplicate-pending or already-paid guards are fine to skip here.
      }
    }
  }

  const fresh = await prisma.pendingTruck.findUnique({
    where: { id: truckId },
    include: TRUCK_INCLUDE,
  });
  return truckRowToRuntime(fresh!);
}

import { TradeDirection, TradeStatus } from "@prisma/client";
import {
  buyingCategoryFromIncoterms,
  DEFAULT_QUALITY_TOLERANCES,
  executionProfileFromTrade,
  KG_PER_MAUND,
  tradeScopeFromSeed,
  type BuyingCategory,
  type ExecutionProfile,
  type QualityTolerances,
  type TradeScope,
} from "@/lib/trade-constants";
import { kgToQuantityUnit, openQtyEpsilon } from "@/lib/unit-conversion";
import {
  DEFAULT_QUANTITY_TOLERANCE_MT,
  parseQuantityToleranceMt,
  shouldAutoCloseContract,
} from "@/lib/contract-closure";
import { defaultKgPerUnit } from "@/lib/price-units";
import type { MockTraderTrade } from "@/server/dummy-data";
import {
  mockAllTraderTrades,
  mockTradeByRefGlobal,
  mockTraderTradeByRef,
  syncBookedTradesFromDisk,
  upsertBookedTrade,
} from "@/server/dummy-data";
import { lockedContractsToCsv } from "@/lib/execution-csv";
import { canonicalTraderName } from "@/lib/trader-identity";
import { getCompanyWarehouses } from "@/server/trader-master-data";
import {
  allocationsSumMatchesContract,
  contractHasWarehouseAllocation,
  contractMatchesWarehouse,
  formatTraderWarehouseSelections,
  normWarehouseName,
  parseExecutionWarehouseSplit,
  parseTraderWarehouseSelections,
  resolveWarehouseAllocations,
  type WarehouseAllocationLine,
} from "@/lib/warehouse-allocation";
import {
  type ExecutionContract,
  type PendingTruck,
  syncExecutionFromDisk,
  getExecutionRuntime,
  ex,
  persistExecutionState,
  setBatchRefreshingContracts,
} from "./runtime";

function defaultIncotermForProfile(profile: ExecutionProfile): string {
  if (profile === "SALE_EX_WAREHOUSE") return "Ex-Warehouse";
  if (profile === "PURCHASE_SPOT") return "Spot";
  return "Delivered";
}

function contractFromTrade(trade: MockTraderTrade): ExecutionContract | null {
  if (!trade.lockedAt) return null;
  if (
    trade.tradeStatus !== TradeStatus.LOCKED &&
    trade.tradeStatus !== TradeStatus.EXECUTED &&
    trade.tradeStatus !== TradeStatus.SETTLED
  ) {
    return null;
  }
  const profile = (trade.executionProfile ??
    executionProfileFromTrade(trade.direction, trade.buyingCategory, trade.incoterms)) as ExecutionProfile;
  const fulfilled = getFulfilledQtyForTrade(trade.tradeRef, trade.direction);
  const open = Math.max(0, trade.quantity - fulfilled);
  const qtyUnit = trade.quantityUnit ?? trade.commodity.unit ?? "MT";
  const toleranceMt = parseQuantityToleranceMt(trade.quantity, qtyUnit, trade.tradeParams);
  const autoClose = shouldAutoCloseContract({
    contractualQtyMt: trade.quantity,
    receivedQtyMt: fulfilled,
    toleranceMt,
  });
  const forceClosed =
    trade.tradeStatus === TradeStatus.EXECUTED || trade.tradeStatus === TradeStatus.SETTLED;
  const traderSelections = traderWarehouseSelectionsFromTrade(trade);
  const traderHint = formatTraderWarehouseSelections(traderSelections);
  return {
    tradeRef: trade.tradeRef,
    tradeId: trade.id,
    contractDate: trade.tradeDate,
    direction: trade.direction,
    executionProfile: profile,
    tradeScope: trade.tradeScope ?? tradeScopeFromSeed(trade.tradeRef),
    incoterms: trade.incoterms || defaultIncotermForProfile(profile),
    buyingCategory: trade.buyingCategory ?? (profile === "PURCHASE_SPOT" ? "Spot" : profile === "PURCHASE_DELIVERED" ? "Delivered" : null),
    commodityCode: trade.commodity.code,
    commodityName: trade.commodity.name,
    counterpartyName: trade.counterparty.name,
    counterpartyCode: trade.counterparty.code,
    counterpartyNtn: trade.counterparty.ntn ?? null,
    quantityUnit: trade.quantityUnit ?? trade.commodity.unit ?? "MT",
    contractualQtyMt: trade.quantity,
    receivedQtyMt: fulfilled,
    openQtyMt: open,
    contractStatus: forceClosed || autoClose ? "Close" : "Open",
    quantityToleranceMt: toleranceMt,
    qualityTolerances: trade.qualityTolerancesDetail ?? DEFAULT_QUALITY_TOLERANCES,
    ratePerMaund: trade.ratePerMaund ?? null,
    ratePerKg:
      trade.ratePerKg ??
      (trade.pricePerCanonicalQty != null
        ? trade.pricePerCanonicalQty / defaultKgPerUnit(trade.quantityUnit ?? "MT")
        : trade.ratePerMaund
          ? trade.ratePerMaund / KG_PER_MAUND
          : trade.price / 1000),
    unitPrice: trade.price ?? null,
    priceCurrency: trade.priceCurrency ?? null,
    priceWeightUnit: trade.priceWeightUnit ?? trade.quantityUnit ?? null,
    commissionPerMaund: trade.commissionPerMaund ?? null,
    currency: trade.currency,
    warehouseDefault: traderHint,
    traderWarehouseHint: traderHint,
    traderWarehouseSelections: traderSelections,
    allocatedWarehouse: null,
    warehouseAllocations: [],
    traderName: trade.traderName,
    lockedAt: trade.lockedAt,
    lockedBy: trade.lockedBy ?? trade.traderName,
    deliveryStart: trade.deliveryStart ?? null,
    deliveryEnd: trade.deliveryEnd ?? null,
  };
}

export function refreshContract(tradeRef: string) {
  const rt = getExecutionRuntime();
  const all = getAllTradesFlat();
  const trade = all.find((t) => t.tradeRef === tradeRef);
  if (!trade?.lockedAt) {
    const hasActivity =
      rt.inboundReceipts.some((r) => r.tradeRef === tradeRef) ||
      rt.outboundDispatches.some((d) => d.tradeRef === tradeRef);
    if (!hasActivity) rt.contracts.delete(tradeRef);
    return;
  }
  if (
    trade.tradeStatus !== TradeStatus.LOCKED &&
    trade.tradeStatus !== TradeStatus.EXECUTED &&
    trade.tradeStatus !== TradeStatus.SETTLED
  ) {
    const hasActivity =
      rt.inboundReceipts.some((r) => r.tradeRef === tradeRef) ||
      rt.outboundDispatches.some((d) => d.tradeRef === tradeRef);
    if (!hasActivity) rt.contracts.delete(tradeRef);
    return;
  }
  const c = contractFromTrade(trade);
  if (c) {
    // Preserve execution-owned fields that are not derived from the trade.
    const prev = rt.contracts.get(tradeRef);
    if (prev?.warehouseAllocations?.length) {
      c.warehouseAllocations = prev.warehouseAllocations;
      c.allocatedWarehouse = prev.allocatedWarehouse;
    } else if (prev?.allocatedWarehouse) {
      c.allocatedWarehouse = prev.allocatedWarehouse;
      c.warehouseAllocations = [
        { warehouseName: prev.allocatedWarehouse, qtyMt: c.contractualQtyMt },
      ];
    }
    rt.contracts.set(tradeRef, c);
    if (c.contractStatus === "Close" && trade.tradeStatus === TradeStatus.LOCKED) {
      trade.tradeStatus = TradeStatus.EXECUTED;
      upsertBookedTrade(trade);
    }
  }
}

/** Ensure every locked / closed contract is in the contracts map. */
export function syncAllLockedContracts(): void {
  syncBookedTradesFromDisk();
  syncExecutionFromDisk();
  setBatchRefreshingContracts(true);
  try {
    for (const t of getAllTradesFlat()) {
      if (
        t.tradeStatus === TradeStatus.LOCKED ||
        ((t.tradeStatus === TradeStatus.EXECUTED || t.tradeStatus === TradeStatus.SETTLED) && t.lockedAt)
      ) {
        refreshContract(t.tradeRef);
      }
    }
    persistExecutionState();
  } finally {
    setBatchRefreshingContracts(false);
  }
}

function normWarehouse(s: string): string {
  return normWarehouseName(s);
}

function normCp(s: string) {
  return s.trim().toLowerCase();
}

export function contractRequiresWarehouse(c: ExecutionContract): boolean {
  return c.executionProfile === "PURCHASE_DELIVERED" || c.executionProfile === "SALE_EX_WAREHOUSE";
}

function traderWarehouseSelectionsFromTrade(trade: MockTraderTrade): string[] {
  return parseTraderWarehouseSelections(trade.tradeParams ?? null);
}

function traderWarehouseHintFromTrade(trade: MockTraderTrade): string | null {
  return formatTraderWarehouseSelections(traderWarehouseSelectionsFromTrade(trade));
}

function resolveCompanyWarehouseName(hint: string): string | null {
  const key = normWarehouse(hint);
  const match = getCompanyWarehouses().find((w) => normWarehouse(w.name) === key);
  return match?.name ?? null;
}

export function counterpartyMatchesTruck(truck: PendingTruck, contract: ExecutionContract): boolean {
  const cp = normCp(contract.counterpartyName);
  const n = normCp(truck.counterpartyName);
  return cp === n || cp.includes(n) || n.includes(cp);
}

export function commodityMatchesTruck(truck: PendingTruck, contract: ExecutionContract): boolean {
  if (!truck.commodityCode?.trim()) return true;
  return contract.commodityCode === truck.commodityCode;
}

export function fifoSortContracts(contracts: ExecutionContract[]): ExecutionContract[] {
  return [...contracts].sort((a, b) => {
    const da = a.deliveryEnd ? new Date(a.deliveryEnd).getTime() : Infinity;
    const db = b.deliveryEnd ? new Date(b.deliveryEnd).getTime() : Infinity;
    if (da !== db) return da - db;
    return a.lockedAt.getTime() - b.lockedAt.getTime();
  });
}

export function normalizeContract(c: ExecutionContract): ExecutionContract {
  if (!(c as Partial<ExecutionContract>).quantityUnit) {
    c.quantityUnit = "MT";
  }
  if (!(c as Partial<ExecutionContract>).tradeScope) {
    c.tradeScope = tradeScopeFromSeed(c.tradeRef);
  }
  if (!(c as Partial<ExecutionContract>).incoterms) {
    c.incoterms = defaultIncotermForProfile(c.executionProfile);
  }
  if ((c as Partial<ExecutionContract>).allocatedWarehouse === undefined) {
    c.allocatedWarehouse = null;
  }
  if ((c as Partial<ExecutionContract>).traderWarehouseHint === undefined) {
    c.traderWarehouseHint = null;
  }
  if (!(c as Partial<ExecutionContract>).traderWarehouseSelections?.length) {
    c.traderWarehouseSelections = c.traderWarehouseHint
      ? c.traderWarehouseHint.split(/\s+\+\s+/).map((s) => s.trim()).filter(Boolean)
      : [];
  }
  if (!(c as Partial<ExecutionContract>).warehouseAllocations) {
    c.warehouseAllocations = resolveWarehouseAllocations(c);
  }
  if ((c as Partial<ExecutionContract>).quantityToleranceMt == null) {
    c.quantityToleranceMt = DEFAULT_QUANTITY_TOLERANCE_MT;
  }
  if (!c.warehouseAllocations.length && c.allocatedWarehouse?.trim()) {
    c.warehouseAllocations = [
      { warehouseName: c.allocatedWarehouse.trim(), qtyMt: c.contractualQtyMt },
    ];
  }
  if (c.warehouseAllocations.length === 1) {
    c.allocatedWarehouse = c.warehouseAllocations[0]!.warehouseName;
  } else if (c.warehouseAllocations.length > 1) {
    c.allocatedWarehouse = c.warehouseAllocations.map((a) => a.warehouseName).join(" + ");
  } else {
    c.allocatedWarehouse = null;
  }
  if (c.unitPrice == null && c.ratePerMaund != null) {
    c.unitPrice = c.ratePerMaund;
    c.priceCurrency = c.priceCurrency ?? (c.currency === "USD" ? "USD" : "PKR");
    c.priceWeightUnit = c.priceWeightUnit ?? "MAUND_40";
  }
  return c;
}

/** Formats a date as YYYY-MM-DD for user-facing delivery-window messages. */
function deliveryDateLabel(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * A trade must be fulfilled within its booked delivery period. Blocks a movement
 * dated outside the window unless the caller is allowed to override (head of
 * execution). Applies to all trades — local and international.
 */
export function assertWithinDeliveryWindow(
  contract: ExecutionContract,
  when: Date,
  allowOutside: boolean,
): void {
  if (allowOutside) return;
  const day = new Date(when);
  day.setHours(0, 0, 0, 0);
  if (contract.deliveryStart) {
    const start = new Date(contract.deliveryStart);
    start.setHours(0, 0, 0, 0);
    if (day < start) {
      throw new Error(
        `Delivery window for ${contract.tradeRef} opens ${deliveryDateLabel(contract.deliveryStart)}. Fulfilment cannot start earlier — the head of execution can override.`,
      );
    }
  }
  if (contract.deliveryEnd) {
    const end = new Date(contract.deliveryEnd);
    end.setHours(0, 0, 0, 0);
    if (day > end) {
      throw new Error(
        `Delivery window for ${contract.tradeRef} closed ${deliveryDateLabel(contract.deliveryEnd)}. The trade must be fulfilled within its delivery period — the head of execution can override.`,
      );
    }
  }
}

function assertCanEditWarehouseAllocation(contract: ExecutionContract): void {
  if (contract.contractStatus !== "Open") {
    throw new Error(
      `Trade ${contract.tradeRef} is fully fulfilled — warehouse allocation can no longer be changed`,
    );
  }
}

/** Merge remaining (open) qty split with locked fulfilled qty per warehouse into stored totals. */
function mergeOpenAllocationsToTotals(
  contract: ExecutionContract,
  openAllocations: { warehouseName: string; openQtyMt: number }[],
): WarehouseAllocationLine[] {
  const unit = contract.quantityUnit;
  const progress = getWarehouseAllocationProgress(contract);
  const fulfilledByWh = new Map(
    progress.map((p) => [normWarehouse(p.warehouseName), p.fulfilledQtyMt]),
  );
  const displayNameByWh = new Map<string, string>();
  for (const p of progress) {
    displayNameByWh.set(normWarehouse(p.warehouseName), p.warehouseName);
  }

  const openByWh = new Map<string, number>();
  for (const line of openAllocations) {
    const name = line.warehouseName?.trim();
    if (!name) throw new Error("Each warehouse line must have a warehouse name");
    const key = normWarehouse(name);
    if (line.openQtyMt < 0) {
      throw new Error(`Open quantity for ${name} cannot be negative`);
    }
    displayNameByWh.set(key, name);
    openByWh.set(key, (openByWh.get(key) ?? 0) + line.openQtyMt);
  }

  const whKeys = new Set<string>();
  for (const p of progress) {
    if (p.fulfilledQtyMt > openQtyEpsilon(unit) || p.openQtyMt > openQtyEpsilon(unit)) {
      whKeys.add(normWarehouse(p.warehouseName));
    }
  }
  for (const key of openByWh.keys()) whKeys.add(key);

  let openSum = 0;
  const totals: WarehouseAllocationLine[] = [];
  for (const key of whKeys) {
    const fulfilled = fulfilledByWh.get(key) ?? 0;
    const open = openByWh.get(key) ?? 0;
    const total = fulfilled + open;
    if (total <= openQtyEpsilon(unit) && fulfilled <= openQtyEpsilon(unit) && open <= openQtyEpsilon(unit)) {
      continue;
    }
    if (open <= openQtyEpsilon(unit) && fulfilled <= openQtyEpsilon(unit)) continue;
    const name = displayNameByWh.get(key);
    if (!name) throw new Error("Warehouse name missing for allocation line");
    totals.push({ warehouseName: name, qtyMt: total });
    openSum += open;
  }

  if (!allocationsSumMatchesContract(openSum, contract.openQtyMt, unit)) {
    throw new Error(
      `Remaining split must total ${contract.openQtyMt} ${unit} (currently ${openSum.toFixed(3)} ${unit})`,
    );
  }

  const totalSum = totals.reduce((s, t) => s + t.qtyMt, 0);
  if (!allocationsSumMatchesContract(totalSum, contract.contractualQtyMt, unit)) {
    throw new Error(
      `Total per warehouse (fulfilled + remaining) must equal ${contract.contractualQtyMt} ${unit} (currently ${totalSum.toFixed(3)} ${unit})`,
    );
  }

  return totals;
}

export function allocateContractWarehouse(
  tradeRef: string,
  warehouseName: string | null,
): ExecutionContract {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  if (!rt.contracts.has(tradeRef)) refreshContract(tradeRef);
  const contract = rt.contracts.get(tradeRef);
  if (!contract) throw new Error("Locked contract not found: " + tradeRef);
  const normalized = normalizeContract(contract);
  assertCanEditWarehouseAllocation(normalized);
  if (!warehouseName?.trim()) {
    const fulfillment = getFulfillmentByWarehouse(tradeRef, normalized.direction);
    if ([...fulfillment.values()].some((f) => f.qtyMt > openQtyEpsilon(normalized.quantityUnit))) {
      throw new Error(
        "Cannot clear warehouse allocation while quantity has already been received or dispatched",
      );
    }
    contract.warehouseAllocations = [];
    contract.allocatedWarehouse = null;
  } else {
    const progress = getWarehouseAllocationProgress(normalized);
    const hasOtherFulfillment = progress.some(
      (p) =>
        normWarehouse(p.warehouseName) !== normWarehouse(warehouseName) &&
        p.fulfilledQtyMt > openQtyEpsilon(normalized.quantityUnit),
    );
    if (hasOtherFulfillment) {
      throw new Error(
        "Trade is partially fulfilled at other warehouses — use the split editor to reassign the remaining quantity",
      );
    }
    contract.warehouseAllocations = mergeOpenAllocationsToTotals(normalized, [
      { warehouseName: warehouseName.trim(), openQtyMt: normalized.openQtyMt },
    ]);
    contract.allocatedWarehouse = warehouseName.trim();
  }
  rt.contracts.set(tradeRef, contract);
  persistExecutionState();
  return normalizeContract(contract);
}

export function allocateContractWarehousesSplit(
  tradeRef: string,
  openAllocations: { warehouseName: string; openQtyMt: number }[],
): ExecutionContract {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  if (!rt.contracts.has(tradeRef)) refreshContract(tradeRef);
  const contract = rt.contracts.get(tradeRef);
  if (!contract) throw new Error("Locked contract not found: " + tradeRef);
  const normalized = normalizeContract(contract);
  assertCanEditWarehouseAllocation(normalized);
  if (!contractRequiresWarehouse(normalized)) {
    throw new Error("This trade type does not use warehouse allocation");
  }
  if (!openAllocations.length) {
    throw new Error("At least one warehouse line is required");
  }
  const seen = new Set<string>();
  for (const line of openAllocations) {
    const key = normWarehouse(line.warehouseName.trim());
    if (seen.has(key)) {
      throw new Error(`Duplicate warehouse "${line.warehouseName}" in allocation split`);
    }
    seen.add(key);
  }
  contract.warehouseAllocations = mergeOpenAllocationsToTotals(normalized, openAllocations);
  rt.contracts.set(tradeRef, contract);
  persistExecutionState();
  return normalizeContract(contract);
}

function getAllTradesFlat(): MockTraderTrade[] {
  return mockAllTraderTrades();
}

function getFulfilledQtyForTrade(tradeRef: string, direction: TradeDirection): number {
  const rt = ex();
  if (direction === TradeDirection.SELL) {
    return rt.outboundDispatches
      .filter((d) => d.tradeRef === tradeRef && d.status !== "AT_GATE")
      .reduce((s, d) => s + d.allocatedQtyMt, 0);
  }
  const inbound = rt.inboundReceipts
    .filter((r) => r.tradeRef === tradeRef && r.status !== "DRAFT")
    .reduce((s, r) => s + r.allocatedQtyMt, 0);
  const spot = rt.spotEvents.get(tradeRef);
  const tradeForUnit = getAllTradesFlat().find((t) => t.tradeRef === tradeRef);
  const unit = tradeForUnit?.quantityUnit ?? tradeForUnit?.commodity.unit ?? "MT";
  const spotQty =
    spot?.state === "RECEIVED" && spot.warehouseReceiveWeightKg
      ? kgToQuantityUnit(spot.warehouseReceiveWeightKg, unit)
      : 0;
  return inbound + spotQty;
}

function getFulfillmentByWarehouse(
  tradeRef: string,
  direction: TradeDirection,
): Map<string, { name: string; qtyMt: number }> {
  const rt = ex();
  const map = new Map<string, { name: string; qtyMt: number }>();
  if (direction === TradeDirection.SELL) {
    for (const d of rt.outboundDispatches) {
      if (d.tradeRef !== tradeRef || d.status === "AT_GATE") continue;
      const key = normWarehouse(d.warehouseName);
      const prev = map.get(key);
      map.set(key, {
        name: d.warehouseName,
        qtyMt: (prev?.qtyMt ?? 0) + d.allocatedQtyMt,
      });
    }
  } else {
    for (const r of rt.inboundReceipts) {
      if (r.tradeRef !== tradeRef || r.status === "DRAFT") continue;
      const key = normWarehouse(r.warehouseName);
      const prev = map.get(key);
      map.set(key, {
        name: r.warehouseName,
        qtyMt: (prev?.qtyMt ?? 0) + r.allocatedQtyMt,
      });
    }
  }
  return map;
}

export function getFulfilledQtyForTradeAtWarehouse(
  tradeRef: string,
  warehouseName: string,
  direction: TradeDirection,
): number {
  const rt = ex();
  const wh = normWarehouse(warehouseName);
  if (direction === TradeDirection.SELL) {
    return rt.outboundDispatches
      .filter(
        (d) =>
          d.tradeRef === tradeRef &&
          d.status !== "AT_GATE" &&
          normWarehouse(d.warehouseName) === wh,
      )
      .reduce((s, d) => s + d.allocatedQtyMt, 0);
  }
  return rt.inboundReceipts
    .filter(
      (r) =>
        r.tradeRef === tradeRef &&
        r.status !== "DRAFT" &&
        normWarehouse(r.warehouseName) === wh,
    )
    .reduce((s, r) => s + r.allocatedQtyMt, 0);
}

/** @deprecated use getFulfilledQtyForTrade */
function getReceivedQtyForTrade(tradeRef: string): number {
  const trade = getAllTradesFlat().find((t) => t.tradeRef === tradeRef);
  return getFulfilledQtyForTrade(tradeRef, trade?.direction ?? TradeDirection.BUY);
}

export function lockTradeInStore(
  traderName: string,
  tradeRef: string,
  input: {
    lockedBy: string;
    buyingCategory?: BuyingCategory;
    ratePerMaund?: number;
    commissionPerMaund?: number;
    qualityTolerances?: QualityTolerances;
  },
): MockTraderTrade {
  const trade =
    mockTraderTradeByRef(canonicalTraderName(traderName), tradeRef) ?? mockTradeByRefGlobal(tradeRef);
  if (!trade) throw new Error("Trade not found");
  if (trade.tradeStatus !== TradeStatus.PENDING) {
    throw new Error(`Only PENDING trades can be locked (current: ${trade.tradeStatus})`);
  }
  if (trade.pendingTraderPrice) {
    throw new Error(
      "Trader must enter the contract price from My Trades before this trade can be locked",
    );
  }
  // Internal routing only — derived from the trade's incoterm (only "Spot" uses
  // the spot pipeline). Trades stay categorized by their incoterm everywhere.
  const buyingCategory =
    trade.direction === TradeDirection.SELL
      ? null
      : (input.buyingCategory ??
        buyingCategoryFromIncoterms(trade.incoterms, trade.direction) ??
        trade.buyingCategory ??
        "Delivered");
  const profile = executionProfileFromTrade(trade.direction, buyingCategory, trade.incoterms);

  // Real settlement rate is per kg (base currency). Prefer an explicit maund rate, else the
  // canonical mapped price, else legacy fallbacks. `ratePerMaund` is kept for display continuity.
  const canonicalKg = defaultKgPerUnit(trade.quantityUnit ?? "MT");
  let ratePerMaund: number;
  let ratePerKg: number;
  if (input.ratePerMaund != null) {
    ratePerMaund = input.ratePerMaund;
    ratePerKg = ratePerMaund / KG_PER_MAUND;
  } else if (trade.pricePerCanonicalQty != null) {
    ratePerKg = trade.pricePerCanonicalQty / canonicalKg;
    ratePerMaund = ratePerKg * KG_PER_MAUND;
  } else {
    ratePerMaund = trade.ratePerMaund ?? trade.price;
    ratePerKg = ratePerMaund / KG_PER_MAUND;
  }

  trade.tradeStatus = TradeStatus.LOCKED;
  trade.lockedAt = new Date();
  trade.lockedBy = input.lockedBy;
  trade.buyingCategory = buyingCategory;
  trade.executionProfile = profile;
  trade.ratePerMaund = ratePerMaund;
  trade.ratePerKg = ratePerKg;
  trade.commissionPerMaund = input.commissionPerMaund ?? trade.commissionPerMaund ?? 0;
  trade.qualityTolerancesDetail = input.qualityTolerances ?? trade.qualityTolerancesDetail ?? DEFAULT_QUALITY_TOLERANCES;

  // IMPORTANT: Save to the underlying store BEFORE refreshing the contract
  upsertBookedTrade(trade);

  refreshContract(tradeRef);

  const rt = getExecutionRuntime();
  const contract = rt.contracts.get(tradeRef);
  if (contract && contractRequiresWarehouse(contract)) {
    const splitPlan = parseExecutionWarehouseSplit(trade.tradeParams);
    if (splitPlan.length > 0 && trade.warehouseSplitApproved !== false) {
      contract.warehouseAllocations = splitPlan.map((line) => ({
        warehouseName: resolveCompanyWarehouseName(line.warehouseName) ?? line.warehouseName,
        qtyMt: line.openQtyMt,
      }));
      contract.allocatedWarehouse =
        contract.warehouseAllocations.length === 1
          ? contract.warehouseAllocations[0]!.warehouseName
          : null;
      rt.contracts.set(tradeRef, contract);
    }
  }

  if (profile === "PURCHASE_SPOT") {
    ex().spotEvents.set(tradeRef, {
      id: `spot-${tradeRef}`,
      tradeRef,
      state: "CONTRACT",
      selectorNotes: null,
      brokerName: null,
      dcNo: null,
      truckNo: null,
      spotWeightKg: null,
      brokerInvoiceRef: null,
      invoiceAmount: null,
      warehouseReceiveWeightKg: null,
      weightVarianceKg: null,
      paymentRequestId: null,
    });
  }

  persistExecutionState();
  return trade;
}

/** Move a locked contract to closed (EXECUTED) — manual or auto-close path. */
export function closeLockedContract(tradeRef: string, closedBy: string): MockTraderTrade {
  syncBookedTradesFromDisk();
  syncExecutionFromDisk();
  const ref = tradeRef.trim();
  const trade = mockTradeByRefGlobal(ref);
  if (!trade) throw new Error("Trade not found");
  if (trade.tradeStatus !== TradeStatus.LOCKED) {
    throw new Error(`Only locked contracts can be closed (current: ${trade.tradeStatus})`);
  }
  const rt = getExecutionRuntime();
  const prev = rt.contracts.get(ref);
  if (prev) {
    rt.contracts.set(ref, { ...normalizeContract(prev), contractStatus: "Close" });
  }
  trade.tradeStatus = TradeStatus.EXECUTED;
  upsertBookedTrade(trade);
  refreshContract(ref);
  persistExecutionState();
  return trade;
}

export type WarehouseAllocationProgress = WarehouseAllocationLine & {
  fulfilledQtyMt: number;
  openQtyMt: number;
};

export function getWarehouseAllocationProgress(
  contract: ExecutionContract,
): WarehouseAllocationProgress[] {
  const c = normalizeContract(contract);
  const fulfillment = getFulfillmentByWarehouse(c.tradeRef, c.direction);
  const allocated = resolveWarehouseAllocations(c);
  const keys = new Set<string>();
  for (const a of allocated) keys.add(normWarehouse(a.warehouseName));
  for (const key of fulfillment.keys()) keys.add(key);

  const nameByKey = new Map<string, string>();
  for (const a of allocated) nameByKey.set(normWarehouse(a.warehouseName), a.warehouseName);
  for (const [key, val] of fulfillment) nameByKey.set(key, val.name);

  return [...keys]
    .map((key) => {
      const warehouseName = nameByKey.get(key)!;
      const allocQty = allocated
        .filter((a) => normWarehouse(a.warehouseName) === key)
        .reduce((s, a) => s + a.qtyMt, 0);
      const fulfilledQtyMt = fulfillment.get(key)?.qtyMt ?? 0;
      const qtyMt = allocQty > openQtyEpsilon(c.quantityUnit) ? allocQty : fulfilledQtyMt;
      return {
        warehouseName,
        qtyMt,
        fulfilledQtyMt,
        openQtyMt: Math.max(0, qtyMt - fulfilledQtyMt),
      };
    })
    .filter(
      (p) =>
        p.qtyMt > openQtyEpsilon(c.quantityUnit) ||
        p.fulfilledQtyMt > openQtyEpsilon(c.quantityUnit),
    )
    .sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));
}

/**
 * Ensure in-memory contracts mirror the trade book.
 * Cheap when warm (mtime-gated disk sync). Full rebuild only when contracts map is empty
 * but locked trades exist, or when forceRebuild is true (mutations should call syncAllLockedContracts).
 */
export function ensureContractsMirror(): void {
  syncBookedTradesFromDisk();
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  if (rt.contracts.size > 0) return;
  const hasLocked = getAllTradesFlat().some(
    (t) =>
      t.tradeStatus === TradeStatus.LOCKED ||
      ((t.tradeStatus === TradeStatus.EXECUTED || t.tradeStatus === TradeStatus.SETTLED) && t.lockedAt),
  );
  if (hasLocked) syncAllLockedContracts();
}

export type ExecutionContractView = ExecutionContract & {
  warehouseAllocationProgress: WarehouseAllocationProgress[];
};

export function withWarehouseProgress(contract: ExecutionContract): ExecutionContractView {
  const c = normalizeContract(contract);
  return { ...c, warehouseAllocationProgress: getWarehouseAllocationProgress(c) };
}

export function getLockedContracts(filter?: {
  profile?: ExecutionProfile;
  incoterms?: string;
  tradeScope?: TradeScope;
  openOnly?: boolean;
  from?: Date;
  to?: Date;
  warehouseName?: string;
  warehouseAllocated?: boolean;
  warehouseUnallocated?: boolean;
}): ExecutionContractView[] {
  ensureContractsMirror();
  // Touch runtime once so subsequent progress lookups hit warm memory.
  const rt = ex();
  let list = [...rt.contracts.values()].map(normalizeContract);
  if (filter?.profile) list = list.filter((c) => c.executionProfile === filter.profile);
  if (filter?.incoterms) list = list.filter((c) => c.incoterms === filter.incoterms);
  if (filter?.tradeScope) list = list.filter((c) => c.tradeScope === filter.tradeScope);
  if (filter?.openOnly) list = list.filter((c) => c.contractStatus === "Open");
  if (filter?.from) list = list.filter((c) => c.lockedAt >= filter.from!);
  if (filter?.to) list = list.filter((c) => c.lockedAt <= filter.to!);
  if (filter?.warehouseAllocated) {
    list = list.filter((c) => contractHasWarehouseAllocation(c));
  }
  if (filter?.warehouseUnallocated) {
    list = list.filter((c) => contractRequiresWarehouse(c) && !contractHasWarehouseAllocation(c));
  }
  if (filter?.warehouseName?.trim()) {
    list = list.filter((c) => contractMatchesWarehouse(c, filter.warehouseName!));
  }
  return list.sort((a, b) => b.lockedAt.getTime() - a.lockedAt.getTime()).map(withWarehouseProgress);
}

/** Open warehouse-backed trades still waiting for execution head to assign a warehouse. */
export function getContractsPendingWarehouseAllocation(): ExecutionContractView[] {
  return getLockedContracts({ openOnly: true, warehouseUnallocated: true });
}

export function getContractByRef(tradeRef: string): ExecutionContractView | null {
  ensureContractsMirror();
  const contract = getExecutionRuntime().contracts.get(tradeRef);
  return contract ? withWarehouseProgress(normalizeContract(contract)) : null;
}

export function getPendingTradesForExecution() {
  syncBookedTradesFromDisk();
  return getAllTradesFlat()
    .filter(
      (t) =>
        t.tradeStatus === TradeStatus.PENDING &&
        t.submittedToExecution === true &&
        t.pendingTraderReview === true,
    )
    .map((t) => ({
      tradeRef: t.tradeRef,
      tradeDate: t.tradeDate,
      traderName: t.traderName,
      direction: t.direction,
      commodityCode: t.commodity.code,
      commodityName: t.commodity.name,
      quantity: t.quantity,
      quantityUnit: t.quantityUnit ?? t.commodity.unit,
      counterpartyName: t.counterparty.name,
      buyingCategory: t.buyingCategory,
      tradeScope: t.tradeScope ?? tradeScopeFromSeed(t.tradeRef),
      executionProfile: t.executionProfile ?? null,
      expectedProfile: executionProfileFromTrade(t.direction, t.buyingCategory, t.incoterms),
    }));
}

export function getDeskSummary() {
  ensureContractsMirror();
  const rt = ex();
  const locked = [...rt.contracts.values()].map(withWarehouseProgress);
  const pending = getPendingTradesForExecution();
  const openTrades = getAllTradesFlat().filter(
    (t) => t.tradeStatus === TradeStatus.PENDING && t.submittedToExecution === true,
  );
  const open = locked.filter((c) => c.contractStatus === "Open");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const vehiclesToday =
    rt.inboundReceipts.filter((r) => r.receiveDate >= today).length +
    rt.outboundDispatches.filter((d) => d.dispatchDate >= today).length;
  const pendingFinance = rt.paymentRequests.filter((p) => p.status === "PENDING").length;
  const pendingTrucksUnassigned = rt.pendingTrucks.filter(
    (t) => t.status === "PENDING" || t.status === "PARTIAL",
  ).length;
  const pendingWarehouseAllocation = open.filter(
    (c) => contractRequiresWarehouse(c) && !contractHasWarehouseAllocation(c),
  ).length;
  return {
    pendingLock: pending.length,
    openTrades: openTrades.length,
    pendingWarehouseAllocation,
    lockedOpen: open.length,
    lockedTotal: locked.length,
    vehiclesToday,
    pendingFinance,
    pendingTrucksUnassigned,
    purchaseDeliveredOpen: open.filter((c) => c.executionProfile === "PURCHASE_DELIVERED").length,
    purchaseSpotOpen: open.filter((c) => c.executionProfile === "PURCHASE_SPOT").length,
    saleOpen: open.filter((c) => c.executionProfile === "SALE_EX_WAREHOUSE").length,
    localOpen: open.filter((c) => c.tradeScope === "LOCAL").length,
    internationalOpen: open.filter((c) => c.tradeScope === "INTERNATIONAL").length,
    localPurchaseDeliveredOpen: open.filter(
      (c) => c.executionProfile === "PURCHASE_DELIVERED" && c.tradeScope === "LOCAL",
    ).length,
    internationalPurchaseDeliveredOpen: open.filter(
      (c) => c.executionProfile === "PURCHASE_DELIVERED" && c.tradeScope === "INTERNATIONAL",
    ).length,
    localPurchaseSpotOpen: open.filter(
      (c) => c.executionProfile === "PURCHASE_SPOT" && c.tradeScope === "LOCAL",
    ).length,
    internationalPurchaseSpotOpen: open.filter(
      (c) => c.executionProfile === "PURCHASE_SPOT" && c.tradeScope === "INTERNATIONAL",
    ).length,
    localSaleOpen: open.filter(
      (c) => c.executionProfile === "SALE_EX_WAREHOUSE" && c.tradeScope === "LOCAL",
    ).length,
    internationalSaleOpen: open.filter(
      (c) => c.executionProfile === "SALE_EX_WAREHOUSE" && c.tradeScope === "INTERNATIONAL",
    ).length,
  };
}

export function exportLockedContractsCsv(
  from: Date,
  to: Date,
  profile?: ExecutionProfile,
  incoterms?: string,
) {
  const list = getLockedContracts({ from, to, profile, incoterms });
  return lockedContractsToCsv(list);
}

/** Ensure contracts mirror is loaded (cheap when warm). Full rebuild only if needed. */
export function seedExecutionDemoIfEmpty() {
  ensureContractsMirror();
}

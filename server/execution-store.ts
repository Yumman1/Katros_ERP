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
import { suggestFifoAllocation } from "@/lib/fifo-allocation";
import { kgToQuantityUnit, quantityUnitToKg, openQtyEpsilon, isOpenQty } from "@/lib/unit-conversion";
import type { MockTraderTrade } from "@/server/dummy-data";
import { lockedContractsToCsv } from "@/lib/execution-csv";
import { canonicalTraderName } from "@/lib/trader-identity";

// ─── Pending Truck (Gatepass) Types ───────────────────────────────────────────
export type PendingTruckStatus = "PENDING" | "ASSIGNED" | "PARTIAL";
export type PendingTruck = {
  id: string;
  gatepassNo: string;
  arrivalDate: Date;
  counterpartyName: string;
  brokerName?: string | null;
  movementType: "INBOUND" | "OUTBOUND";
  warehouseName: string;
  truckNo: string;
  driverName?: string | null;
  driverPhone?: string | null;
  /** Builty / consignment note reference and details */
  builtyDetails?: string | null;
  commodityCode?: string | null;
  commodityName?: string | null;
  /** Warehouse manager or staff who logged the gatepass */
  recordedByName?: string | null;
  weightKg: number;
  bags?: number | null;
  remarks?: string | null;
  status: PendingTruckStatus;
  assignedTradeRef?: string | null;
  assignedAt?: Date | null;
  remainingKg: number;
  /** @deprecated legacy persisted trucks only */
  driverCnic?: string | null;
};
import {
  mockAllTraderTrades,
  mockTradeByRefGlobal,
  mockTraderTradeByRef,
  syncBookedTradesFromDisk,
  upsertBookedTrade,
} from "@/server/dummy-data";
import {
  EXECUTION_FILE,
  isLocalPersistEnabled,
  readPersisted,
  writePersisted,
} from "@/server/local-persist";

export type ContractStatus = "Open" | "Close";

export type ExecutionContract = {
  tradeRef: string;
  tradeId: string;
  contractDate: Date;
  direction: TradeDirection;
  executionProfile: ExecutionProfile;
  tradeScope: TradeScope;
  buyingCategory: BuyingCategory | null;
  commodityCode: string;
  commodityName: string;
  counterpartyName: string;
  counterpartyCode: string;
  counterpartyNtn: string | null;
  quantityUnit: string;
  contractualQtyMt: number;
  receivedQtyMt: number;
  openQtyMt: number;
  contractStatus: ContractStatus;
  qualityTolerances: QualityTolerances;
  ratePerMaund: number | null;
  ratePerKg: number | null;
  commissionPerMaund: number | null;
  currency: string;
  warehouseDefault: string | null;
  traderName: string;
  lockedAt: Date;
  lockedBy: string;
  deliveryStart: Date | null;
  deliveryEnd: Date | null;
};

export type InboundReceiptStatus = "DRAFT" | "ALLOCATED" | "FINANCE_PENDING" | "PAID";
export type OutboundDispatchStatus = "AT_GATE" | "WEIGHED" | "FINANCE_PENDING" | "RELEASED";
export type SpotPurchaseState =
  | "CONTRACT"
  | "SELECTED"
  | "LOADED"
  | "DC_ISSUED"
  | "INVOICED"
  | "FINANCE_PENDING"
  | "PAID"
  | "ON_THE_WAY"
  | "RECEIVED";

export type PaymentRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type PaymentSourceType = "INBOUND" | "OUTBOUND" | "SPOT";

export type InboundReceipt = {
  id: string;
  gatepassNo?: string | null;
  kcsNo: string;
  receiveDate: Date;
  truckNo: string;
  driverName?: string | null;
  driverCnic?: string | null;
  driverPhone?: string | null;
  biltyNo: string;
  trnNo: string;
  warehouseName: string;
  sellerName: string;
  tradeRef: string;
  billNo: string | null;
  bags: number | null;
  weightSpotKg: number;
  weightWarehouseKg: number;
  weightDiffKg: number;
  qualityReadings: QualityTolerances;
  deductionPct: number;
  allocatedQtyMt: number;
  fifoOverrideReason: string | null;
  amountDue: number;
  status: InboundReceiptStatus;
  paymentRequestId: string | null;
  documentRefs?: string[];
  remarks?: string | null;
};

export type OutboundDispatch = {
  id: string;
  gatepassNo?: string | null;
  dispatchDate: Date;
  liftedBy: string;
  buyerName: string;
  tradeRef: string;
  warehouseName: string;
  truckNo: string;
  driverName?: string | null;
  driverCnic?: string | null;
  driverPhone?: string | null;
  dispatchWeightKg: number;
  invoiceWeightKg: number;
  fungusPct: number;
  doRef: string | null;
  fifoOverrideReason: string | null;
  allocatedQtyMt: number;
  amountDue: number;
  status: OutboundDispatchStatus;
  paymentRequestId: string | null;
  documentRefs?: string[];
  remarks?: string | null;
};

export type SpotPurchaseEvent = {
  id: string;
  tradeRef: string;
  state: SpotPurchaseState;
  selectorNotes: string | null;
  brokerName: string | null;
  dcNo: string | null;
  truckNo: string | null;
  spotWeightKg: number | null;
  brokerInvoiceRef: string | null;
  invoiceAmount: number | null;
  warehouseReceiveWeightKg: number | null;
  weightVarianceKg: number | null;
  paymentRequestId: string | null;
};

export type PaymentRequest = {
  id: string;
  sourceType: PaymentSourceType;
  sourceId: string;
  tradeRef: string;
  counterpartyName: string;
  amount: number;
  currency: string;
  status: PaymentRequestStatus;
  financeComment: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
};

type ExecutionSnapshot = {
  contracts: [string, ExecutionContract][];
  inboundReceipts: InboundReceipt[];
  outboundDispatches: OutboundDispatch[];
  spotEvents: [string, SpotPurchaseEvent][];
  paymentRequests: PaymentRequest[];
  pendingTrucks: PendingTruck[];
  inboundSeq: number;
  outboundSeq: number;
  paymentSeq: number;
  truckSeq: number;
};

type ExecutionRuntime = {
  contracts: Map<string, ExecutionContract>;
  inboundReceipts: InboundReceipt[];
  outboundDispatches: OutboundDispatch[];
  spotEvents: Map<string, SpotPurchaseEvent>;
  paymentRequests: PaymentRequest[];
  pendingTrucks: PendingTruck[];
  inboundSeq: number;
  outboundSeq: number;
  paymentSeq: number;
  truckSeq: number;
};

const EXEC_RUNTIME_KEY = "__kastrosExecutionRuntime";
const EXEC_BATCH_REFRESH_KEY = "__kastrosExecutionBatchRefresh";

function isBatchRefreshingContracts(): boolean {
  return (globalThis as typeof globalThis & { [EXEC_BATCH_REFRESH_KEY]?: boolean })[
    EXEC_BATCH_REFRESH_KEY
  ] === true;
}

function setBatchRefreshingContracts(value: boolean) {
  (globalThis as typeof globalThis & { [EXEC_BATCH_REFRESH_KEY]?: boolean })[EXEC_BATCH_REFRESH_KEY] =
    value;
}

function getExecutionRuntime(): ExecutionRuntime {
  const g = globalThis as typeof globalThis & {
    [EXEC_RUNTIME_KEY]?: ExecutionRuntime;
  };
  if (!g[EXEC_RUNTIME_KEY]) {
    g[EXEC_RUNTIME_KEY] = {
      contracts: new Map(),
      inboundReceipts: [],
      outboundDispatches: [],
      spotEvents: new Map(),
      paymentRequests: [],
      pendingTrucks: [],
      inboundSeq: 0,
      outboundSeq: 0,
      paymentSeq: 0,
      truckSeq: 0,
    };
  }
  return g[EXEC_RUNTIME_KEY];
}

export function syncExecutionFromDisk(): void {
  if (!isLocalPersistEnabled()) return;
  const snap = readPersisted<ExecutionSnapshot>(EXECUTION_FILE);
  if (!snap) return;
  const rt = getExecutionRuntime();
  rt.contracts.clear();
  for (const [k, v] of snap.contracts) rt.contracts.set(k, v);
  rt.inboundReceipts.length = 0;
  rt.inboundReceipts.push(...snap.inboundReceipts);
  rt.outboundDispatches.length = 0;
  rt.outboundDispatches.push(...snap.outboundDispatches);
  rt.spotEvents.clear();
  for (const [k, v] of snap.spotEvents) rt.spotEvents.set(k, v);
  rt.paymentRequests.length = 0;
  rt.paymentRequests.push(...snap.paymentRequests);
  rt.pendingTrucks.length = 0;
  rt.pendingTrucks.push(...(snap.pendingTrucks ?? []));
  rt.inboundSeq = snap.inboundSeq;
  rt.outboundSeq = snap.outboundSeq;
  rt.paymentSeq = snap.paymentSeq;
  rt.truckSeq = snap.truckSeq ?? 0;
}

function ex() {
  if (!isBatchRefreshingContracts()) syncExecutionFromDisk();
  return getExecutionRuntime();
}

function persistExecutionState() {
  const rt = getExecutionRuntime();
  writePersisted(EXECUTION_FILE, {
    contracts: [...rt.contracts.entries()],
    inboundReceipts: rt.inboundReceipts,
    outboundDispatches: rt.outboundDispatches,
    spotEvents: [...rt.spotEvents.entries()],
    paymentRequests: rt.paymentRequests,
    pendingTrucks: rt.pendingTrucks,
    inboundSeq: rt.inboundSeq,
    outboundSeq: rt.outboundSeq,
    paymentSeq: rt.paymentSeq,
    truckSeq: rt.truckSeq,
  } satisfies ExecutionSnapshot);
}

function contractFromTrade(trade: MockTraderTrade): ExecutionContract | null {
  if (trade.tradeStatus !== TradeStatus.LOCKED || !trade.lockedAt) return null;
  const profile = (trade.executionProfile ??
    executionProfileFromTrade(trade.direction, trade.buyingCategory, trade.incoterms)) as ExecutionProfile;
  const fulfilled = getFulfilledQtyForTrade(trade.tradeRef, trade.direction);
  const open = Math.max(0, trade.quantity - fulfilled);
  return {
    tradeRef: trade.tradeRef,
    tradeId: trade.id,
    contractDate: trade.tradeDate,
    direction: trade.direction,
    executionProfile: profile,
    tradeScope: trade.tradeScope ?? tradeScopeFromSeed(trade.tradeRef),
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
    contractStatus: isOpenQty(open, trade.quantityUnit ?? trade.commodity.unit ?? "MT") ? "Open" : "Close",
    qualityTolerances: trade.qualityTolerancesDetail ?? DEFAULT_QUALITY_TOLERANCES,
    ratePerMaund: trade.ratePerMaund ?? null,
    ratePerKg: trade.ratePerKg ?? (trade.ratePerMaund ? trade.ratePerMaund / KG_PER_MAUND : trade.price / 1000),
    commissionPerMaund: trade.commissionPerMaund ?? null,
    currency: trade.currency,
    warehouseDefault: trade.destName || trade.originName || null,
    traderName: trade.traderName,
    lockedAt: trade.lockedAt,
    lockedBy: trade.lockedBy ?? trade.traderName,
    deliveryStart: trade.deliveryStart ?? null,
    deliveryEnd: trade.deliveryEnd ?? null,
  };
}

function refreshContract(tradeRef: string) {
  const rt = getExecutionRuntime();
  const all = getAllTradesFlat();
  const trade = all.find((t) => t.tradeRef === tradeRef);
  if (!trade || trade.tradeStatus !== TradeStatus.LOCKED) {
    const hasActivity =
      rt.inboundReceipts.some((r) => r.tradeRef === tradeRef) ||
      rt.outboundDispatches.some((d) => d.tradeRef === tradeRef);
    if (!hasActivity) rt.contracts.delete(tradeRef);
    return;
  }
  const c = contractFromTrade(trade);
  if (c) rt.contracts.set(tradeRef, c);
}

/** Ensure every LOCKED trade is in the contracts map (fixes spot / fresh-lock visibility). */
export function syncAllLockedContracts(): void {
  syncBookedTradesFromDisk();
  syncExecutionFromDisk();
  setBatchRefreshingContracts(true);
  try {
    for (const t of getAllTradesFlat()) {
      if (t.tradeStatus === TradeStatus.LOCKED) refreshContract(t.tradeRef);
    }
    persistExecutionState();
  } finally {
    setBatchRefreshingContracts(false);
  }
}

function normCp(s: string) {
  return s.trim().toLowerCase();
}

function counterpartyMatchesTruck(truck: PendingTruck, contract: ExecutionContract): boolean {
  const cp = normCp(contract.counterpartyName);
  const names = [truck.counterpartyName, truck.brokerName].filter(Boolean).map((n) => normCp(n!));
  return names.some((n) => cp === n || cp.includes(n) || n.includes(cp));
}

function commodityMatchesTruck(truck: PendingTruck, contract: ExecutionContract): boolean {
  if (!truck.commodityCode?.trim()) return true;
  return contract.commodityCode === truck.commodityCode;
}

function fifoSortContracts(contracts: ExecutionContract[]): ExecutionContract[] {
  return [...contracts].sort((a, b) => {
    const da = a.deliveryEnd ? new Date(a.deliveryEnd).getTime() : Infinity;
    const db = b.deliveryEnd ? new Date(b.deliveryEnd).getTime() : Infinity;
    if (da !== db) return da - db;
    return a.lockedAt.getTime() - b.lockedAt.getTime();
  });
}

function normalizeContract(c: ExecutionContract): ExecutionContract {
  if (!(c as Partial<ExecutionContract>).quantityUnit) {
    c.quantityUnit = "MT";
  }
  if (!(c as Partial<ExecutionContract>).tradeScope) {
    c.tradeScope = tradeScopeFromSeed(c.tradeRef);
  }
  return c;
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
  if (trade.counterpartyKycStatus !== "VERIFIED") {
    throw new Error("Counterparty must be KYC VERIFIED to lock");
  }

  const buyingCategory =
    trade.direction === TradeDirection.SELL
      ? null
      : (input.buyingCategory ??
        trade.buyingCategory ??
        buyingCategoryFromIncoterms(trade.incoterms, trade.direction) ??
        "Delivered");
  const profile = executionProfileFromTrade(trade.direction, buyingCategory, trade.incoterms);
  const ratePerMaund = input.ratePerMaund ?? trade.ratePerMaund ?? trade.price;
  const ratePerKg = ratePerMaund / KG_PER_MAUND;

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

export function getLockedContracts(filter?: {
  profile?: ExecutionProfile;
  tradeScope?: TradeScope;
  openOnly?: boolean;
  from?: Date;
  to?: Date;
}): ExecutionContract[] {
  syncAllLockedContracts();
  let list = [...ex().contracts.values()].map(normalizeContract);
  if (filter?.profile) list = list.filter((c) => c.executionProfile === filter.profile);
  if (filter?.tradeScope) list = list.filter((c) => c.tradeScope === filter.tradeScope);
  if (filter?.openOnly) list = list.filter((c) => c.contractStatus === "Open");
  if (filter?.from) list = list.filter((c) => c.lockedAt >= filter.from!);
  if (filter?.to) list = list.filter((c) => c.lockedAt <= filter.to!);
  return list.sort((a, b) => b.lockedAt.getTime() - a.lockedAt.getTime());
}

export function getContractByRef(tradeRef: string): ExecutionContract | null {
  syncAllLockedContracts();
  const contract = getExecutionRuntime().contracts.get(tradeRef);
  return contract ? normalizeContract(contract) : null;
}

export function getPendingTradesForExecution() {
  return getAllTradesFlat()
    .filter((t) => t.tradeStatus === TradeStatus.PENDING)
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

/** Counterparties on open locked trades — used for warehouse gate in/out to avoid name typos. */
export function getLiveCounterpartiesForGatepass(
  movementType: "INBOUND" | "OUTBOUND",
): GatepassCounterpartyOption[] {
  syncAllLockedContracts();
  const contracts = getLockedContracts({ openOnly: true }).filter((c) => {
    if (movementType === "INBOUND") {
      return c.direction === TradeDirection.BUY && c.executionProfile === "PURCHASE_DELIVERED";
    }
    return c.direction === TradeDirection.SELL && c.executionProfile === "SALE_EX_WAREHOUSE";
  });

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
): boolean {
  const cp = getLiveCounterpartiesForGatepass(movementType).find((c) => c.name === counterpartyName);
  return cp?.commodities.some((c) => c.code === commodityCode) ?? false;
}

export function isAllowedGatepassCounterparty(
  movementType: "INBOUND" | "OUTBOUND",
  counterpartyName: string,
): boolean {
  const name = counterpartyName.trim();
  return getLiveCounterpartiesForGatepass(movementType).some((c) => c.name === name);
}

export function getDeskSummary() {
  const locked = getLockedContracts();
  const pending = getPendingTradesForExecution();
  const open = locked.filter((c) => c.contractStatus === "Open");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rt = ex();
  const vehiclesToday =
    rt.inboundReceipts.filter((r) => r.receiveDate >= today).length +
    rt.outboundDispatches.filter((d) => d.dispatchDate >= today).length;
  const pendingFinance = rt.paymentRequests.filter((p) => p.status === "PENDING").length;
  const pendingTrucksUnassigned = rt.pendingTrucks.filter(
    (t) => t.status === "PENDING" || t.status === "PARTIAL",
  ).length;
  return {
    pendingLock: pending.length,
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
}) {
  const contract = getContractByRef(input.tradeRef);
  if (!contract) throw new Error("Locked contract not found");

  const rt = ex();
  rt.inboundSeq += 1;
  const weightDiffKg = input.weightWarehouseKg - input.weightSpotKg;
  const deductionPct = computeQualityDeduction(contract.qualityTolerances, input.qualityReadings);
  const netKg = input.weightWarehouseKg * (1 - deductionPct / 100);
  const allocatedQtyMt = kgToQuantityUnit(netKg, contract.quantityUnit);
  const rateKg = contract.ratePerKg ?? contract.ratePerMaund! / KG_PER_MAUND;
  const amountDue = netKg * rateKg;

  const receipt: InboundReceipt = {
    ...input,
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
  options?: { status?: OutboundDispatchStatus },
) {
  const contract = getContractByRef(input.tradeRef);
  if (!contract) throw new Error("Locked sale contract not found");
  const rt = ex();
  rt.outboundSeq += 1;
  const allocatedQtyMt = kgToQuantityUnit(input.invoiceWeightKg, contract.quantityUnit);
  const rateKg = contract.ratePerKg ?? contract.ratePerMaund! / KG_PER_MAUND;
  const amountDue = input.invoiceWeightKg * rateKg;
  const dispatch: OutboundDispatch = {
    ...input,
    id: `out-${rt.outboundSeq}`,
    allocatedQtyMt,
    amountDue,
    status: options?.status ?? "WEIGHED",
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

export function getSpotEvent(tradeRef: string) {
  return ex().spotEvents.get(tradeRef) ?? null;
}

/** Spot pipeline rows for a profile (open contracts + current spot state). */
export function listSpotPipeline(profile: ExecutionProfile = "PURCHASE_SPOT") {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  return [...rt.contracts.values()]
    .filter((c) => c.executionProfile === profile)
    .map((c) => {
      const ev = rt.spotEvents.get(c.tradeRef);
      return {
        tradeRef: c.tradeRef,
        state: ev?.state ?? ("CONTRACT" as SpotPurchaseState),
        brokerName: ev?.brokerName ?? null,
        truckNo: ev?.truckNo ?? null,
      };
    });
}

export function advanceSpotState(
  tradeRef: string,
  next: SpotPurchaseState,
  patch?: Partial<SpotPurchaseEvent>,
) {
  const rt = ex();
  let ev = rt.spotEvents.get(tradeRef);
  if (!ev) {
    ev = {
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
    };
    rt.spotEvents.set(tradeRef, ev);
  }
  Object.assign(ev, patch, { state: next });
  if (next === "RECEIVED" && ev.warehouseReceiveWeightKg != null && ev.spotWeightKg != null) {
    ev.weightVarianceKg = ev.warehouseReceiveWeightKg - ev.spotWeightKg;
    refreshContract(tradeRef);
  }
  persistExecutionState();
  return ev;
}

export function submitSpotForFinance(tradeRef: string) {
  const rt = ex();
  const ev = rt.spotEvents.get(tradeRef);
  if (!ev) throw new Error("Spot event not found");
  const contract = getContractByRef(tradeRef);
  if (!contract) throw new Error("Contract not found");
  const amount = ev.invoiceAmount ?? contract.contractualQtyMt * (contract.ratePerMaund ?? 0) * KG_PER_MAUND;
  rt.paymentSeq += 1;
  const pr: PaymentRequest = {
    id: `pay-${rt.paymentSeq}`,
    sourceType: "SPOT",
    sourceId: ev.id,
    tradeRef,
    counterpartyName: contract.counterpartyName,
    amount,
    currency: contract.currency,
    status: "PENDING",
    financeComment: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date(),
  };
  rt.paymentRequests.push(pr);
  ev.paymentRequestId = pr.id;
  ev.state = "FINANCE_PENDING";
  persistExecutionState();
  return { spot: ev, paymentRequest: pr };
}

export function listPaymentRequests(status?: PaymentRequestStatus) {
  const rt = ex();
  return status ? rt.paymentRequests.filter((p) => p.status === status) : [...rt.paymentRequests];
}

export function approvePayment(paymentId: string, approvedBy: string, comment?: string) {
  const rt = ex();
  const pr = rt.paymentRequests.find((p) => p.id === paymentId);
  if (!pr) throw new Error("Payment request not found");
  if (pr.status !== "PENDING") throw new Error(`Cannot approve status ${pr.status}`);
  pr.status = "APPROVED";
  pr.approvedBy = approvedBy;
  pr.approvedAt = new Date();
  pr.financeComment = comment ?? null;

  if (pr.sourceType === "INBOUND") {
    const r = rt.inboundReceipts.find((x) => x.id === pr.sourceId);
    if (r) r.status = "PAID";
  } else if (pr.sourceType === "OUTBOUND") {
    const d = rt.outboundDispatches.find((x) => x.id === pr.sourceId);
    if (d && d.status === "FINANCE_PENDING") {
      /* stays FINANCE_PENDING until releaseOutbound */
    }
  } else if (pr.sourceType === "SPOT") {
    const ev = [...rt.spotEvents.values()].find((e) => e.id === pr.sourceId);
    if (ev) ev.state = "PAID";
  }
  persistExecutionState();
  return pr;
}

export function rejectPayment(paymentId: string, comment?: string) {
  const rt = ex();
  const pr = rt.paymentRequests.find((p) => p.id === paymentId);
  if (!pr) throw new Error("Payment request not found");
  pr.status = "REJECTED";
  pr.financeComment = comment ?? null;
  if (pr.sourceType === "INBOUND") {
    const r = rt.inboundReceipts.find((x) => x.id === pr.sourceId);
    if (r && r.status === "FINANCE_PENDING") r.status = "ALLOCATED";
  } else if (pr.sourceType === "OUTBOUND") {
    const d = rt.outboundDispatches.find((x) => x.id === pr.sourceId);
    if (d && d.status === "FINANCE_PENDING") d.status = "WEIGHED";
  } else if (pr.sourceType === "SPOT") {
    const ev = [...rt.spotEvents.values()].find((e) => e.id === pr.sourceId);
    if (ev && ev.state === "FINANCE_PENDING") ev.state = "INVOICED";
  }
  persistExecutionState();
  return pr;
}

export function markInboundPaidAfterApproval(receiptId: string) {
  const rt = ex();
  const r = rt.inboundReceipts.find((x) => x.id === receiptId);
  if (!r?.paymentRequestId) throw new Error("No payment linked");
  const pr = rt.paymentRequests.find((p) => p.id === r.paymentRequestId);
  if (pr?.status !== "APPROVED") throw new Error("Payment not approved");
  r.status = "PAID";
  refreshContract(r.tradeRef);
  persistExecutionState();
  return r;
}

export function getPaymentRequests(filter?: { status?: string }) {
  const rt = ex();
  const all = [...rt.paymentRequests].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (filter?.status) return all.filter((p) => p.status === filter.status);
  return all;
}

export function exportLockedContractsCsv(from: Date, to: Date, profile?: ExecutionProfile) {
  const list = getLockedContracts({ from, to, profile });
  return lockedContractsToCsv(list);
}


// ─── Pending Truck Functions ───────────────────────────────────────────────────

export function createPendingTruck(input: {
  counterpartyName: string;
  brokerName?: string | null;
  movementType: "INBOUND" | "OUTBOUND";
  warehouseName: string;
  truckNo: string;
  driverName?: string | null;
  driverPhone?: string | null;
  builtyDetails: string;
  commodityCode: string;
  commodityName: string;
  recordedByName: string;
  weightKg: number;
  bags?: number | null;
  remarks?: string | null;
  gatepassNo?: string | null;
  arrivalDate?: Date;
}): PendingTruck {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  rt.truckSeq += 1;
  const id = `truck-${rt.truckSeq}`;
  const gatepassNo =
    input.gatepassNo?.trim() ||
    `GP-${input.movementType === "INBOUND" ? "IN" : "OUT"}-${rt.truckSeq.toString().padStart(4, "0")}`;
  const truck: PendingTruck = {
    id,
    gatepassNo,
    arrivalDate: input.arrivalDate ?? new Date(),
    counterpartyName: input.counterpartyName.trim(),
    brokerName: input.brokerName?.trim() || null,
    movementType: input.movementType,
    warehouseName: input.warehouseName.trim(),
    truckNo: input.truckNo.trim().toUpperCase(),
    driverName: input.driverName || null,
    driverPhone: input.driverPhone || null,
    builtyDetails: input.builtyDetails.trim(),
    commodityCode: input.commodityCode.trim(),
    commodityName: input.commodityName.trim(),
    recordedByName: input.recordedByName.trim(),
    weightKg: input.weightKg,
    bags: input.bags ?? null,
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
  let list = [...rt.pendingTrucks];
  if (filter?.counterpartyName) {
    const q = filter.counterpartyName.toLowerCase();
    list = list.filter(
      (t) =>
        t.counterpartyName.toLowerCase().includes(q) ||
        (t.brokerName?.toLowerCase().includes(q) ?? false),
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
  const tradeOpenKg = quantityUnitToKg(contract.openQtyMt, contract.quantityUnit);
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
    rt.inboundSeq += 1;
    const netKg = allocateKg;
    const allocatedQtyMt = kgToQuantityUnit(netKg, contract.quantityUnit);
    const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
    const receipt: InboundReceipt = {
      id: `kcs-${rt.inboundSeq}`,
      gatepassNo: truck.gatepassNo,
      kcsNo: `KCS-${rt.inboundSeq}`,
      receiveDate: truck.arrivalDate,
      truckNo: truck.truckNo,
      driverName: truck.driverName,
      driverCnic: truck.driverCnic ?? null,
      driverPhone: truck.driverPhone,
      biltyNo: truck.builtyDetails || "-",
      trnNo: "-",
      warehouseName: truck.warehouseName,
      sellerName: truck.brokerName || truck.counterpartyName,
      tradeRef,
      billNo: null,
      bags: truck.bags ?? null,
      weightSpotKg: allocateKg,
      weightWarehouseKg: allocateKg,
      weightDiffKg: 0,
      qualityReadings: contract.qualityTolerances,
      deductionPct: 0,
      allocatedQtyMt,
      fifoOverrideReason: null,
      amountDue: netKg * rateKg,
      status: "ALLOCATED",
      paymentRequestId: null,
      documentRefs: [truck.gatepassNo, truck.builtyDetails].filter((x): x is string => Boolean(x)),
      remarks: [truck.remarks, truck.commodityName ? `Commodity: ${truck.commodityName}` : null]
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
    const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
    const dispatch: OutboundDispatch = {
      id: `out-${rt.outboundSeq}`,
      gatepassNo: truck.gatepassNo,
      dispatchDate: truck.arrivalDate,
      liftedBy: truck.driverName || truck.counterpartyName,
      buyerName: truck.brokerName || truck.counterpartyName,
      tradeRef,
      warehouseName: truck.warehouseName,
      truckNo: truck.truckNo,
      driverName: truck.driverName,
      driverCnic: truck.driverCnic ?? null,
      driverPhone: truck.driverPhone,
      dispatchWeightKg: allocateKg,
      invoiceWeightKg: allocateKg,
      fungusPct: 0,
      doRef: truck.gatepassNo,
      fifoOverrideReason: null,
      allocatedQtyMt,
      amountDue: allocateKg * rateKg,
      status: "WEIGHED",
      paymentRequestId: null,
      documentRefs: [truck.gatepassNo, truck.builtyDetails].filter((x): x is string => Boolean(x)),
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
      getLockedContracts({ openOnly: true, profile }).filter(
        (c) => counterpartyMatchesTruck(truck!, c) && commodityMatchesTruck(truck!, c),
      ),
    );
    const next = queue.find((c) => c.openQtyMt > 0.001);
    if (!next) break;

    const beforeKg = truck.remainingKg;
    const result = assignTruckToTrade(truckId, next.tradeRef);
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

// ─── Movements CSV Export ──────────────────────────────────────────────────────

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
  const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-PK");
  const rows: string[] = [
    "Type,Gatepass No,Date,Truck No,Warehouse,Trade Ref,Commodity,Counterparty,Gross Wt (kg),Net Qty (MT),Status,Driver,Remarks",
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
        fmtDate(d),
        t.truckNo,
        t.warehouseName,
        "—",
        t.commodityCode ?? "-",
        t.counterpartyName,
        t.remainingKg,
        (t.remainingKg / 1000).toFixed(3),
        "GATEPASS_PENDING",
        t.driverName ?? "",
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
        ["INBOUND", r.gatepassNo ?? r.kcsNo, fmtDate(d), r.truckNo, r.warehouseName, r.tradeRef,
          c?.commodityCode ?? "-", r.sellerName, r.weightWarehouseKg, r.allocatedQtyMt.toFixed(3),
          r.status, r.driverName ?? "", r.remarks ?? ""].map(escape).join(","),
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
        ["OUTBOUND", d2.gatepassNo ?? d2.doRef ?? d2.id, fmtDate(d), d2.truckNo, d2.warehouseName, d2.tradeRef,
          c?.commodityCode ?? "-", d2.buyerName, d2.dispatchWeightKg, d2.allocatedQtyMt.toFixed(3),
          d2.status, d2.driverName ?? "", d2.remarks ?? ""].map(escape).join(","),
      );
    }
  }
  return rows.join("\n");
}

/** Seed demo data if the execution store is empty. Called once per server boot in mock mode. */
export function seedExecutionDemoIfEmpty() {
  syncAllLockedContracts();

  const rt = getExecutionRuntime();

  // If already seeded, contracts were refreshed and persisted above.
  if (rt.inboundReceipts.length > 0 || rt.outboundDispatches.length > 0) {
    return;
  }

  const subDaysLocal = (d: Date, n: number) => new Date(d.getTime() - n * 86400000);
  const today = new Date();

  // ── Inbound receipts for Purchase Delivered ────────────────────────────────
  const inboundSeed = [
    { tradeRef: "KAS-COR26-PUR-0001", kcsNo: "KCS-001", truckNo: "LEP-4501", biltyNo: "BLT-8821", trnNo: "TRN-001", sellerName: "Faiz Ahmed", wh: "K005-Shuja feed Wh", spotKg: 21500, whKg: 21200, moisture: 12.3, damage: 0.8, broken: 1.2, fungus: 0.2, fm: 0.4, daysAgo: 65, status: "PAID" as InboundReceiptStatus },
    { tradeRef: "KAS-COR26-PUR-0001", kcsNo: "KCS-002", truckNo: "MNA-7732", biltyNo: "BLT-8822", trnNo: "TRN-002", sellerName: "Faiz Ahmed", wh: "K005-Shuja feed Wh", spotKg: 19800, whKg: 19500, moisture: 11.8, damage: 1.0, broken: 1.5, fungus: 0.3, fm: 0.5, daysAgo: 63, status: "PAID" as InboundReceiptStatus },
    { tradeRef: "KAS-COR26-PUR-0001", kcsNo: "KCS-003", truckNo: "BRS-3310", biltyNo: "BLT-8824", trnNo: "TRN-003", sellerName: "Faiz Ahmed", wh: "K005-Shuja feed Wh", spotKg: 22100, whKg: 21800, moisture: 12.1, damage: 0.9, broken: 1.8, fungus: 0.1, fm: 0.6, daysAgo: 61, status: "PAID" as InboundReceiptStatus },
    { tradeRef: "KAS-COR26-PUR-0002", kcsNo: "KCS-004", truckNo: "DGS-5510", biltyNo: "BLT-8830", trnNo: "TRN-004", sellerName: "Al Noor Commission Shop", wh: "GodamTech - Silos", spotKg: 20300, whKg: 19900, moisture: 12.4, damage: 1.1, broken: 2.0, fungus: 0.4, fm: 0.7, daysAgo: 58, status: "PAID" as InboundReceiptStatus },
    { tradeRef: "KAS-COR26-PUR-0002", kcsNo: "KCS-005", truckNo: "GLT-1122", biltyNo: "BLT-8831", trnNo: "TRN-005", sellerName: "Al Noor Commission Shop", wh: "GodamTech - Silos", spotKg: 18700, whKg: 18400, moisture: 11.5, damage: 0.7, broken: 1.1, fungus: 0.2, fm: 0.3, daysAgo: 55, status: "ALLOCATED" as InboundReceiptStatus },
    { tradeRef: "KAS-COR26-PUR-0003", kcsNo: "KCS-006", truckNo: "CAJ-8891", biltyNo: "BLT-8840", trnNo: "TRN-006", sellerName: "Ammar Industries", wh: "K005-Shuja feed Wh", spotKg: 25000, whKg: 24600, moisture: 12.2, damage: 0.8, broken: 1.3, fungus: 0.1, fm: 0.4, daysAgo: 50, status: "PAID" as InboundReceiptStatus },
    { tradeRef: "KAS-COR26-PUR-0003", kcsNo: "KCS-007", truckNo: "TAM-4456", biltyNo: "BLT-8842", trnNo: "TRN-007", sellerName: "Ammar Industries", wh: "K005-Shuja feed Wh", spotKg: 23500, whKg: 23100, moisture: 11.9, damage: 0.9, broken: 1.6, fungus: 0.3, fm: 0.5, daysAgo: 47, status: "FINANCE_PENDING" as InboundReceiptStatus },
    { tradeRef: "KAS-COR26-PUR-0004", kcsNo: "KCS-008", truckNo: "MNI-2231", biltyNo: "BLT-8850", trnNo: "TRN-008", sellerName: "Faiz Ahmed", wh: "GodamTech - Silos", spotKg: 21000, whKg: 20700, moisture: 12.0, damage: 0.6, broken: 1.0, fungus: 0.2, fm: 0.3, daysAgo: 38, status: "PAID" as InboundReceiptStatus },
    { tradeRef: "KAS-COR26-PUR-0005", kcsNo: "KCS-009", truckNo: "MIA-7744", biltyNo: "BLT-8860", trnNo: "TRN-009", sellerName: "Al Noor Commission Shop", wh: "K005-Shuja feed Wh", spotKg: 19500, whKg: 19200, moisture: 12.5, damage: 1.2, broken: 1.9, fungus: 0.5, fm: 0.8, daysAgo: 22, status: "ALLOCATED" as InboundReceiptStatus },
    { tradeRef: "KAS-COR26-PUR-0005", kcsNo: "KCS-010", truckNo: "AJKA-6612", biltyNo: "BLT-8862", trnNo: "TRN-010", sellerName: "Al Noor Commission Shop", wh: "K005-Shuja feed Wh", spotKg: 20800, whKg: 20400, moisture: 11.7, damage: 0.8, broken: 1.4, fungus: 0.2, fm: 0.4, daysAgo: 20, status: "DRAFT" as InboundReceiptStatus },
  ];

  rt.inboundSeq = 100;
  for (const s of inboundSeed) {
    const contract = getContractByRef(s.tradeRef);
    if (!contract) continue;
    const weightDiffKg = s.whKg - s.spotKg;
    const qualityReadings = { moisturePct: s.moisture, damagePct: s.damage, brokenPct: s.broken, fungusPct: s.fungus, foreignMatterPct: s.fm };
    const deductionPct = computeQualityDeduction(contract.qualityTolerances, qualityReadings);
    const netKg = s.whKg * (1 - deductionPct / 100);
    const allocatedQtyMt = kgToQuantityUnit(netKg, contract.quantityUnit);
    const rateKg = contract.ratePerKg ?? contract.ratePerMaund! / KG_PER_MAUND;
    rt.inboundSeq += 1;
    rt.inboundReceipts.push({
      id: `kcs-${rt.inboundSeq}`,
      kcsNo: s.kcsNo,
      receiveDate: subDaysLocal(today, s.daysAgo),
      truckNo: s.truckNo,
      biltyNo: s.biltyNo,
      trnNo: s.trnNo,
      warehouseName: s.wh,
      sellerName: s.sellerName,
      tradeRef: s.tradeRef,
      billNo: null,
      bags: Math.round(s.whKg / 50),
      weightSpotKg: s.spotKg,
      weightWarehouseKg: s.whKg,
      weightDiffKg,
      qualityReadings,
      deductionPct,
      allocatedQtyMt,
      fifoOverrideReason: null,
      amountDue: netKg * rateKg,
      status: s.status,
      paymentRequestId: null,
    });
  }

  // ── Outbound dispatches for Sale contracts ─────────────────────────────────
  const outboundSeed = [
    { tradeRef: "KAS-COR26-SAL-0001", truckNo: "MNI-345",  doRef: "KAS-COR25-DO-0049", liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 15110, invKg: 15110, fungus: 0.01, daysAgo: 65, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0001", truckNo: "TKA-719",  doRef: "KAS-COR25-DO-0050", liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 14950, invKg: 14950, fungus: 0.01, daysAgo: 65, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0001", truckNo: "MNS-1030", doRef: "KAS-COR25-DO-0051", liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 20510, invKg: 20510, fungus: 0.01, daysAgo: 65, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0001", truckNo: "DGS-3614", doRef: "KAS-COR25-DO-0052", liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 23540, invKg: 23540, fungus: 0.01, daysAgo: 64, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0002", truckNo: "CAJ-3009", doRef: "KAS-COR25-DO-0054", liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 23910, invKg: 23910, fungus: 0.01, daysAgo: 62, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0002", truckNo: "AJKA-4205",doRef: "KAS-COR25-DO-0055", liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 15630, invKg: 15630, fungus: 0.01, daysAgo: 62, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0002", truckNo: "MNI-345",  doRef: "KAS-COR25-DO-0056", liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 15290, invKg: 15290, fungus: 0.01, daysAgo: 61, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0003", truckNo: "MNS-1030", doRef: "KAS-COR25-DO-0063", liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 22060, invKg: 22060, fungus: 0.01, daysAgo: 60, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0004", truckNo: "BRS-373",  doRef: "KAS-COR25-DO-0071", liftedBy: "Asaaf Commission Agent",     wh: "K005-Shuja feed Wh", dispKg: 25000, invKg: 25000, fungus: 0.01, daysAgo: 58, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0007", truckNo: "TAM-801",  doRef: "KAS-COR25-DO-0090", liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 19800, invKg: 19800, fungus: 0.01, daysAgo: 50, status: "RELEASED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0007", truckNo: "GLT-450",  doRef: null,                liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 21500, invKg: 21500, fungus: 0.01, daysAgo: 48, status: "WEIGHED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0008", truckNo: "MNI-9900", doRef: null,                liftedBy: "Ishaq & Sons Commission Shop",wh: "GodamTech - Silos",   dispKg: 18000, invKg: 18000, fungus: 0.01, daysAgo: 25, status: "FINANCE_PENDING" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0010", truckNo: "BRS-1010", doRef: null,                liftedBy: "Rashid Iqbal Commission Shop",wh: "GodamTech - Silos",  dispKg: 15500, invKg: 15500, fungus: 0.01, daysAgo: 15, status: "WEIGHED" as OutboundDispatchStatus },
    { tradeRef: "KAS-COR26-SAL-0015", truckNo: "DGS-4422", doRef: null,                liftedBy: "Ghullam Yaseen Enterprises", wh: "K005-Shuja feed Wh", dispKg: 22000, invKg: 22000, fungus: 0.01, daysAgo: 8,  status: "AT_GATE" as OutboundDispatchStatus },
  ];

  rt.outboundSeq = 200;
  for (const s of outboundSeed) {
    const contract = getContractByRef(s.tradeRef);
    if (!contract) continue;
    const allocatedQtyMt = kgToQuantityUnit(s.invKg, contract.quantityUnit);
    const rateKg = contract.ratePerKg ?? contract.ratePerMaund! / KG_PER_MAUND;
    rt.outboundSeq += 1;
    const disp: OutboundDispatch = {
      id: `out-${rt.outboundSeq}`,
      dispatchDate: new Date(today.getTime() - s.daysAgo * 86400000),
      liftedBy: s.liftedBy,
      buyerName: s.liftedBy,
      tradeRef: s.tradeRef,
      warehouseName: s.wh,
      truckNo: s.truckNo,
      dispatchWeightKg: s.dispKg,
      invoiceWeightKg: s.invKg,
      fungusPct: s.fungus,
      doRef: s.doRef,
      fifoOverrideReason: null,
      allocatedQtyMt,
      amountDue: s.invKg * rateKg,
      status: s.status,
      paymentRequestId: null,
    };
    rt.outboundDispatches.push(disp);
  }

  // ── Spot events ────────────────────────────────────────────────────────────
  const spotSeed: { tradeRef: string; state: SpotPurchaseState; broker: string; dc: string; truck: string; spotKg: number; invRef: string; invAmt: number; wkKg: number }[] = [
    { tradeRef: "KAS-COR26-SPT-0001", state: "RECEIVED", broker: "Chaudhary Brokerage", dc: "DC-88221", truck: "LEP-7712", spotKg: 52000, invRef: "INV-SPT-001", invAmt: 5_980_000, wkKg: 51800 },
    { tradeRef: "KAS-COR26-SPT-0002", state: "INVOICED", broker: "Punjab Commission Agent", dc: "DC-88350", truck: "MNA-4432", spotKg: 76000, invRef: "INV-SPT-002", invAmt: 10_540_000, wkKg: 0 },
    { tradeRef: "KAS-COR26-SPT-0003", state: "LOADED", broker: "Mandi Commission Wala", dc: "", truck: "BRS-9901", spotKg: 101000, invRef: "", invAmt: 0, wkKg: 0 },
  ];

  for (const s of spotSeed) {
    rt.spotEvents.set(s.tradeRef, {
      id: `spot-${s.tradeRef}`,
      tradeRef: s.tradeRef,
      state: s.state,
      selectorNotes: "Selected FAQ grade corn from Anaaj Mandi. Good moisture levels.",
      brokerName: s.broker || null,
      dcNo: s.dc || null,
      truckNo: s.truck || null,
      spotWeightKg: s.spotKg || null,
      brokerInvoiceRef: s.invRef || null,
      invoiceAmount: s.invAmt || null,
      warehouseReceiveWeightKg: s.state === "RECEIVED" ? s.wkKg : null,
      weightVarianceKg: s.state === "RECEIVED" ? s.wkKg - s.spotKg : null,
      paymentRequestId: null,
    });
  }

  // ── Payment requests ───────────────────────────────────────────────────────
  rt.paymentSeq = 300;
  // One pending outbound payment (for the FINANCE_PENDING dispatch)
  const fpDispatch = rt.outboundDispatches.find(d => d.status === "FINANCE_PENDING");
  if (fpDispatch) {
    rt.paymentSeq += 1;
    const pr: PaymentRequest = {
      id: `pay-${rt.paymentSeq}`,
      sourceType: "OUTBOUND",
      sourceId: fpDispatch.id,
      tradeRef: fpDispatch.tradeRef,
      counterpartyName: fpDispatch.buyerName,
      amount: fpDispatch.amountDue,
      currency: "PKR",
      status: "PENDING",
      financeComment: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date(today.getTime() - 25 * 86400000),
    };
    rt.paymentRequests.push(pr);
    fpDispatch.paymentRequestId = pr.id;
  }
  // One pending inbound payment
  const fpInbound = rt.inboundReceipts.find(r => r.status === "FINANCE_PENDING");
  if (fpInbound) {
    rt.paymentSeq += 1;
    const pr: PaymentRequest = {
      id: `pay-${rt.paymentSeq}`,
      sourceType: "INBOUND",
      sourceId: fpInbound.id,
      tradeRef: fpInbound.tradeRef,
      counterpartyName: fpInbound.sellerName,
      amount: fpInbound.amountDue,
      currency: "PKR",
      status: "PENDING",
      financeComment: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date(today.getTime() - 47 * 86400000),
    };
    rt.paymentRequests.push(pr);
    fpInbound.paymentRequestId = pr.id;
  }

  // Refresh all contract quantities now that receipts/dispatches are seeded
  syncAllLockedContracts();
}

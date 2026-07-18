import { subDays, addDays } from "date-fns";
import {
  getMergedCommodities,
  getMergedCounterparties,
  getMergedLocations,
} from "@/server/trader-master-data";
import { getDeskMarketPrice, marketTickerPayload } from "@/server/market-prices";
import { canonicalTraderName, traderNamesMatch } from "@/lib/trader-identity";
import type { KycStatus, QualityTolerances } from "@/lib/trade-constants";
import { DEFAULT_QUALITY_TOLERANCES, priceBasisRequiresQuote } from "@/lib/trade-constants";
import {
  baseCurrencyOf,
  defaultKgPerUnit,
  toPricePerCanonicalQty,
  type PriceCurrency,
} from "@/lib/price-units";
import { toMt } from "@/lib/unit-registry";
import {
  isLocalPersistEnabled,
  persistedFileMtime,
  readPersisted,
  TRADES_FILE,
  writePersisted,
} from "@/server/local-persist";
import {
  CashFlowType,
  CounterpartyType,
  InventoryStatus,
  InvoiceStatus,
  MovementType,
  ReconStatus,
  ReconType,
  TradeDirection,
  TradeStatus,
  TraceEventType,
  Role,
  LocationType,
} from "@prisma/client";

const now = () => new Date();

/** SSE / ticker — execution desk CNF only */
export function mockPriceTickerPayload() {
  return marketTickerPayload();
}

export function mockCredentialsUser(email: string) {
  const e = email.toLowerCase();
  const role =
    e.includes("ceo") ? Role.CEO
    : e.includes("risk") ? Role.RISK_MANAGER
    : e.includes("finance") ? Role.FINANCE
    : e.includes("trader") ? Role.TRADER
    : e.includes("execution") ? Role.EXECUTION
    : e.includes("view") || e.includes("read") ? Role.READ_ONLY
    : Role.ADMIN;
  const isHead = e.includes("head") || e.includes("lead") || role === Role.ADMIN;
  const name =
    role === Role.CEO ? "Executive Office"
    : role === Role.TRADER ? "Ayesha Malik"
    : role === Role.EXECUTION ? "Asad Hussain"
    : role === Role.RISK_MANAGER ? "Omar Khan"
    : role === Role.FINANCE ? "Sana Rizvi"
    : role === Role.READ_ONLY ? "Read Only User"
    : "Kastros Admin";
  return {
    id:
      role === Role.CEO
        ? "mock-ceo-1"
        : role === Role.TRADER
        ? "mock-trader-1"
        : role === Role.EXECUTION
          ? "mock-execution-1"
          : "mock-user-1",
    email: e,
    name,
    role,
    isHead,
  };
}

export function mockPositionsSummaryCards(): Array<{
  commodityId: string;
  code: string;
  name: string;
  longQty: number;
  shortQty: number;
  netQty: number;
  avgBuyPrice: number | null;
  avgSellPrice: number | null;
  marketPrice: number;
  dayChangePct: number;
}> {
  return [];
}

export function mockExposureSummary() {
  return {
    totalLong: 0,
    totalShort: 0,
    netExposure: 0,
    netMTM: 0,
    asOf: now().toISOString(),
  };
}

export type MockPositionBookRow = {
  id: string;
  commodity: string;
  commodityName: string;
  commodityId: string;
  direction: TradeDirection;
  quantity: number;
  bookPrice: number;
  marketPrice: number;
  mtmPnl: number;
  unrealizedPnl: number;
  pctChange: number;
  bookValue?: number;
  marketValue?: number;
  currency: string;
  tradeRef: string;
  counterparty: string;
  updatedAt?: string;
};

export function mockPositionBook(_commodityId?: string): MockPositionBookRow[] {
  return [];
}

export function mockMtmBook(opts?: { commodityId?: string; sign?: "pos" | "neg" | "all" }) {
  const book = mockPositionBook(opts?.commodityId);
  const rows = book.map((r) => ({
    tradeRef: r.tradeRef,
    commodity: r.commodity,
    qty: r.quantity,
    direction: r.direction,
    bookPrice: r.bookPrice,
    marketPrice: r.marketPrice,
    mtmPnl: r.mtmPnl,
    unrealizedPnl: r.unrealizedPnl,
    valueDate: now().toISOString(),
    currency: r.currency,
    counterparty: r.counterparty,
  }));
  const filtered =
    opts?.sign === "pos" ? rows.filter((r) => r.mtmPnl >= 0)
    : opts?.sign === "neg" ? rows.filter((r) => r.mtmPnl < 0)
    : rows;
  const totalUnrealizedPnl = filtered.reduce((a, r) => a + r.unrealizedPnl, 0);
  return { rows: filtered, totalUnrealizedPnl, openCount: filtered.length };
}

export function mockMtmHistory(_days: number): Array<{ date: string; total: number }> {
  return [];
}

export function mockPnlAttribution() {
  return {
    totalPnl: 0,
    priceEffect: 0,
    volumeEffect: 0,
    fxEffect: 0,
    other: 0,
    rows: [],
  };
}

export function mockCashflowList(_projectedOnly?: boolean | null) {
  return {
    rows: [],
    summary: { receipts: 0, payments: 0, net: 0, opening: 0, closing: 0 },
  };
}

export function mockUpcomingInvoices() {
  return [];
}

export function mockReconciliationList(_filter?: { type?: ReconType; status?: ReconStatus }) {
  return [];
}

export function mockReconciliationSummary() {
  return { matched: 0, break: 0, pending: 0, resolved: 0, total: 0 };
}

export function mockAutoReconcile() {
  return { matched: 0, breaks: 0, message: "No records to reconcile" };
}
export type ShipmentStatus =
  | "PLANNED"
  | "LOADING"
  | "IN_TRANSIT"
  | "AT_PORT"
  | "DELIVERED"
  | "DELAYED"
  | "CANCELLED";

export type MockShipmentRow = {
  id: string;
  reference: string;
  blRef: string | null;
  tradeRef: string;
  commodity: string;
  counterparty: string;
  quantity: number;
  carrier: string | null;
  vesselName: string | null;
  originName: string;
  destName: string;
  location: { name: string };
  shippedAt: Date | null;
  eta: Date | null;
  status: ShipmentStatus;
};

export function mockInventorySummary(): Array<{
  code: string;
  onHand: number;
  reserved: number;
  transit: number;
  value: number;
}> {
  return [];
}

export function mockInventoryList(
  _locationId?: string,
  _commodityId?: string,
  _status?: InventoryStatus,
): Array<{
  id: string;
  locationId: string;
  locationName: string;
  commodityId: string;
  commodity: string;
  code: string;
  quantity: number;
  reservedQty: number;
  inTransitQty: number;
  totalValue: number;
  status: InventoryStatus;
  lotRef: string;
  receivedAt: Date;
}> {
  return [];
}

export function mockInventoryMovements(_inventoryId?: string): Array<{
  id: string;
  inventoryId: string;
  type: MovementType;
  quantity: number;
  reference: string;
  createdAt: Date;
}> {
  return [];
}

export function mockInventoryAging(): Array<{
  id: string;
  warehouseRef: string | null;
  commodity: string;
  location: string;
  quantity: number;
  available: number;
  reserved: number;
  daysInStorage: number;
  agingBucket: string;
  expiryDate: Date | null;
  qualityGrade: string | null;
}> {
  return [];
}

export function mockShipments(_filter?: {
  status?: ShipmentStatus;
  locationId?: string;
}): MockShipmentRow[] {
  return [];
}

export function mockShipmentSummary() {
  return {
    total: 0,
    inTransit: 0,
    delayed: 0,
    delivered30d: 0,
    totalQtyInPipeline: 0,
  };
}

export type MockLocationDetailRow = {
  id: string;
  name: string;
  type: LocationType;
  country: string;
  region: string;
  capacityMt: number;
  onHand: number;
  reserved: number;
  inTransit: number;
  value: number;
  utilization: number;
  commodities: string[];
  activeShipments: number;
  availableCapacity: number;
  lotCount: number;
};

export function mockLocationsDetail(): MockLocationDetailRow[] {
  return getMergedLocations().map((loc) => ({
    id: loc.id,
    name: loc.name,
    type: LocationType.WAREHOUSE,
    country: "PK",
    region: loc.province ?? "Unassigned",
    capacityMt: loc.capacitySqFt ?? 0,
    onHand: 0,
    reserved: 0,
    inTransit: 0,
    value: 0,
    utilization: 0,
    commodities: [] as string[],
    activeShipments: 0,
    availableCapacity: loc.capacitySqFt ?? 0,
    lotCount: 0,
  }));
}

export type MockCounterpartyScmRow = {
  id: string;
  name: string;
  code: string;
  type: CounterpartyType;
  country: string;
  kycStatus: KycStatus;
  companyNameNtn: string | null;
  ntn: string | null;
  address: string | null;
  bankDetails: string | null;
  creditLimit: number;
  activeTrades: number;
  openShipments: number;
  onTimeDeliveryPct: number;
  avgLeadTimeDays: number;
  commoditiesSupplied: string[];
  lastDelivery: Date | null;
};

export function mockCounterpartiesScm(): MockCounterpartyScmRow[] {
  return getMergedCounterparties().map((cp) => ({
    id: cp.id,
    name: cp.name,
    code: cp.code,
    type: cp.type,
    country: cp.country,
    kycStatus: cp.kycStatus,
    companyNameNtn: cp.companyNameNtn,
    ntn: cp.ntn,
    address: cp.address,
    bankDetails: cp.bankDetails,
    creditLimit: 0,
    activeTrades: 0,
    openShipments: 0,
    onTimeDeliveryPct: 0,
    avgLeadTimeDays: 0,
    commoditiesSupplied: [] as string[],
    lastDelivery: null,
  }));
}

export function mockSupplyChainOverview(): {
  kpis: {
    totalOnHand: number;
    totalReserved: number;
    totalTransit: number;
    totalValue: number;
    availableToSell: number;
    fillRate: number;
    avgDwellDays: number;
    shipmentsInPipeline: number;
    delayedShipments: number;
    avgLocationUtilization: number;
    openPurchaseTrades: number;
    awaitingReceipt: number;
  };
  pipeline: Array<{
    stage: string;
    count: number;
    qtyMt: number;
    status: "complete" | "pending";
  }>;
  alerts: Array<{
    id: string;
    severity: "high" | "medium" | "low";
    message: string;
  }>;
} {
  return {
    kpis: {
      totalOnHand: 0,
      totalReserved: 0,
      totalTransit: 0,
      totalValue: 0,
      availableToSell: 0,
      fillRate: 0,
      avgDwellDays: 0,
      shipmentsInPipeline: 0,
      delayedShipments: 0,
      avgLocationUtilization: 0,
      openPurchaseTrades: 0,
      awaitingReceipt: 0,
    },
    pipeline: [],
    alerts: [],
  };
}

export function mockPositionVsInventory() {
  return [];
}

export function mockKpis() {
  return {
    tradesYtd: 0,
    openTrades: 0,
    inventoryValue: 0,
    openMtmPnl: 0,
  };
}

export function mockTradeBlotter(): Array<{
  tradeRef: string;
  tradeDate: Date;
  commodity: { code: string; name: string };
  direction: TradeDirection;
  quantity: number;
  price: number;
  counterparty: { name: string };
  status: TradeStatus;
}> {
  return [];
}

export function mockOpenBreaks(): Array<{
  id: string;
  type: ReconType;
  status: ReconStatus;
  description: string;
  amount: number;
}> {
  return [];
}

export function mockCommodityList() {
  return getMergedCommodities();
}

export function mockTraceSearch(_q?: string, _commodityId?: string): Array<{
  id: string;
  lotRef: string;
  commodity: string;
  eventType: TraceEventType;
  location: string;
  timestamp: Date;
}> {
  return [];
}

export function mockTraceById(_id: string) {
  return null;
}

export function mockTradesForCommodity(): Array<{
  id: string;
  tradeRef: string;
  commodityId: string;
  direction: TradeDirection;
  quantity: number;
  price: number;
  counterparty: string;
}> {
  return [];
}

// --- Trader desk (mock) ---

export type PaymentType =
  | "DP"
  | "LC"
  | "CAD"
  | "ADVANCE_100"
  | "CREDIT"
  | "CREDIT_30"
  | "AFTER_DELIVERY_100";
export type { KycStatus };

import { PAYMENT_TYPE_LABELS, paymentTypeLabel, tradeScopeFromSeed } from "@/lib/trade-constants";

export type MockTraderTrade = {
  id: string;
  tradeRef: string;
  tradeDate: Date;
  traderName: string;
  desk: string;
  direction: TradeDirection;
  quantity: number;
  quantityUnit: string;
  price: number;
  currency: string;
  priceBasis: string;
  tradeStatus: TradeStatus;
  deliveryStart: Date;
  deliveryEnd: Date;
  originName: string;
  destName: string;
  incoterms: string;
  paymentType: PaymentType;
  paymentTerms: string;
  grade: string;
  productOrigin: string;
  qualityTolerances: string;
  maxMoisturePct?: number | null;
  counterpartyKycStatus: KycStatus;
  counterpartyKycRef: string | null;
  contractRef: string | null;
  commodity: { id: string; code: string; name: string; unit: string };
  counterparty: {
    id: string;
    name: string;
    code: string;
    companyNameNtn?: string | null;
    ntn?: string | null;
    address?: string | null;
    bankDetails?: string | null;
  };
  marketPrice: number;
  mtmPnl: number;
  notes?: string;
  buyingCategory?: "Delivered" | "Spot" | null;
  tradeScope?: "LOCAL" | "INTERNATIONAL";
  executionProfile?: string | null;
  ratePerMaund?: number | null;
  ratePerKg?: number | null;
  commissionPerMaund?: number | null;
  /** Quoted price metric for this trade (currency + weight unit + kg factor). */
  priceCurrency?: PriceCurrency | null;
  priceWeightUnit?: string | null;
  priceKgPerUnit?: number | null;
  /** Price mapped to the canonical quantity unit, in the settlement (base) currency. */
  pricePerCanonicalQty?: number | null;
  /** Flat broker commission in the quoted price currency (e.g. PKR, USD, or US cents). */
  commissionAmount?: number | null;
  /** @deprecated per-weight commission — use commissionAmount */
  commissionPerUnit?: number | null;
  commissionPerCanonicalQty?: number | null;
  /** Quantity as originally entered before MT conversion. */
  quantityEntered?: number | null;
  quantityEnteredUnit?: string | null;
  /** Flexible commodity-specific and global trade fields (broker, quality specs, etc.). */
  tradeParams?: Record<string, string | number | null> | null;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  /** Sent to execution Open Trades (still PENDING until locked). */
  submittedToExecution?: boolean;
  submittedToExecutionAt?: Date | null;
  /** Execution edited the trade — trader must review before locking. */
  pendingTraderReview?: boolean;
  /** Unfixed / index-linked trade submitted without price — trader must enter price before execution can lock. */
  pendingTraderPrice?: boolean;
  executionEditNote?: string | null;
  executionLastEditedBy?: string | null;
  executionLastEditedAt?: Date | null;
  /** Head approved qty split across warehouses — required before lock. */
  warehouseSplitApproved?: boolean;
  warehouseSplitApprovedAt?: Date | null;
  warehouseSplitApprovedBy?: string | null;
  /** Staff submitted warehouse split awaiting head approval. */
  pendingWarehouseApproval?: boolean;
  qualityTolerancesDetail?: {
    damagePct: number;
    brokenPct: number;
    fungusPct: number;
    foreignMatterPct: number;
    moisturePct: number;
  } | null;
  /** Chronological edit / approval events visible to trader and execution. */
  activityLog?: {
    id: string;
    at: Date;
    actorName: string;
    actorSide: "TRADER" | "EXECUTION" | "CEO";
    kind: string;
    requiresApproval: boolean;
    summary: string;
    note?: string | null;
    changeCount?: number;
    changeRequestId?: string;
    payload?: Record<string, unknown> | null;
  }[];
};

type BookedTradesSnapshot = {
  mockTradeSeq: number;
  bookedTrades: MockTraderTrade[];
};

type BookedRuntime = {
  trades: MockTraderTrade[];
  mockTradeSeq: number;
};

const BOOKED_RUNTIME_KEY = "__kastrosBookedRuntime";
const BOOKED_DISK_MTIME_KEY = "__kastrosBookedDiskMtime";
const BOOKED_DISK_LOADED_KEY = "__kastrosBookedDiskLoaded";

function getBookedRuntime(): BookedRuntime {
  const g = globalThis as typeof globalThis & {
    [BOOKED_RUNTIME_KEY]?: BookedRuntime;
  };
  if (!g[BOOKED_RUNTIME_KEY]) {
    g[BOOKED_RUNTIME_KEY] = { trades: [], mockTradeSeq: 10020 };
  }
  return g[BOOKED_RUNTIME_KEY];
}

/** Sync booked trades from disk only when file mtime changed (or first load). */
export function syncBookedTradesFromDisk(force = false): void {
  if (!isLocalPersistEnabled()) return;
  const g = globalThis as typeof globalThis & {
    [BOOKED_DISK_MTIME_KEY]?: number;
    [BOOKED_DISK_LOADED_KEY]?: boolean;
  };
  const mtime = persistedFileMtime(TRADES_FILE);
  if (!force && g[BOOKED_DISK_LOADED_KEY] && g[BOOKED_DISK_MTIME_KEY] === mtime) {
    return;
  }
  const snap = readPersisted<BookedTradesSnapshot>(TRADES_FILE);
  g[BOOKED_DISK_LOADED_KEY] = true;
  g[BOOKED_DISK_MTIME_KEY] = mtime;
  if (!snap) return;
  const rt = getBookedRuntime();
  rt.trades.length = 0;
  let backfilled = false;
  for (const raw of snap.bookedTrades) {
    if (!raw.tradeScope) {
      raw.tradeScope = tradeScopeFromSeed(raw.tradeRef);
      backfilled = true;
    }
    rt.trades.push(raw);
  }
  if (snap.mockTradeSeq > rt.mockTradeSeq) rt.mockTradeSeq = snap.mockTradeSeq;
  if (backfilled) persistBookedTrades();
}

function getBookedTrades(): MockTraderTrade[] {
  syncBookedTradesFromDisk();
  return getBookedRuntime().trades;
}

function persistBookedTrades() {
  const rt = getBookedRuntime();
  writePersisted(TRADES_FILE, {
    mockTradeSeq: rt.mockTradeSeq,
    bookedTrades: rt.trades,
  } satisfies BookedTradesSnapshot);
  const g = globalThis as typeof globalThis & {
    [BOOKED_DISK_MTIME_KEY]?: number;
    [BOOKED_DISK_LOADED_KEY]?: boolean;
  };
  g[BOOKED_DISK_LOADED_KEY] = true;
  g[BOOKED_DISK_MTIME_KEY] = persistedFileMtime(TRADES_FILE);
}

/** Keep booked / locked / updated trades on disk (survives logout and server restart). */
export function upsertBookedTrade(trade: MockTraderTrade) {
  const rt = getBookedRuntime();
  const idx = rt.trades.findIndex((t) => t.tradeRef === trade.tradeRef);
  if (idx >= 0) rt.trades[idx] = trade;
  else rt.trades.unshift(trade);
  persistBookedTrades();
}

/** Remove a booked trade from the local trade book. */
export function deleteBookedTrade(tradeRef: string): { ok: true } {
  syncBookedTradesFromDisk();
  const rt = getBookedRuntime();
  const idx = rt.trades.findIndex((t) => t.tradeRef === tradeRef);
  if (idx < 0) {
    throw new Error("Trade not found");
  }
  rt.trades.splice(idx, 1);
  persistBookedTrades();
  return { ok: true };
}

function buildTraderTrade(
  partial: Partial<Omit<MockTraderTrade, "marketPrice" | "mtmPnl">> &
    Pick<
      MockTraderTrade,
      | "id"
      | "tradeRef"
      | "tradeDate"
      | "traderName"
      | "desk"
      | "direction"
      | "quantity"
      | "price"
      | "currency"
      | "tradeStatus"
      | "deliveryStart"
      | "deliveryEnd"
      | "originName"
      | "destName"
      | "paymentTerms"
      | "contractRef"
      | "commodity"
      | "counterparty"
    > & { marketPrice?: number },
): MockTraderTrade {
  const merged: Omit<MockTraderTrade, "marketPrice" | "mtmPnl"> = {
    quantityUnit: "MT",
    grade: "Grade A",
    productOrigin: partial.originName,
    qualityTolerances: "Max moisture 14%; foreign matter 2% max",
    maxMoisturePct: partial.maxMoisturePct ?? null,
    incoterms: "FOB",
    paymentType: "LC",
    priceBasis: "Fixed",
    counterpartyKycStatus: "VERIFIED",
    counterpartyKycRef: "KYC-2025-001",
    notes: undefined,
    tradeScope: partial.tradeScope ?? tradeScopeFromSeed(partial.tradeRef),
    ...partial,
  };
  // Book price is compared on a per-canonical-quantity-unit basis so quantity (canonical)
  // drives notional and MTM consistently regardless of how the trade was quoted.
  const bookUnitPrice = merged.pricePerCanonicalQty ?? merged.price;
  const marketPrice = partial.marketPrice ?? bookUnitPrice * (1 + (Math.random() - 0.45) * 0.02);
  const desk = partial.commodity?.code ? getDeskMarketPrice(partial.commodity.code) : null;
  const mktPrice = desk?.cnf?.amount ?? desk?.yesterday?.amount ?? marketPrice;
  const q = merged.quantity;
  const book = q * bookUnitPrice;
  const mkt = q * mktPrice;
  const mtmPnl =
    merged.direction === TradeDirection.BUY ? mkt - book : book - mkt;
  return { ...merged, marketPrice: mktPrice, mtmPnl };
}

export function mockTraderTrades(
  traderName: string,
  filter?: { status?: TradeStatus; bucket?: "DRAFTS" | "CLOSED" },
) {
  syncBookedTradesFromDisk();
  const canonical = canonicalTraderName(traderName);
  let rows = getBookedTrades().filter((t) => traderNamesMatch(t.traderName, canonical));

  if (filter?.bucket === "DRAFTS") {
    rows = rows.filter((t) => t.tradeStatus === TradeStatus.PENDING);
  } else if (filter?.bucket === "CLOSED") {
    rows = rows.filter(
      (t) => t.tradeStatus === TradeStatus.EXECUTED || t.tradeStatus === TradeStatus.SETTLED,
    );
  } else if (filter?.status) {
    rows = rows.filter((t) => t.tradeStatus === filter.status);
  }

  return rows.sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime());
}

export function mockTraderTradeByRef(traderName: string, tradeRef: string) {
  const ref = tradeRef.trim();
  const canonical = canonicalTraderName(traderName);
  const trade =
    mockTraderTrades(traderName).find((t) => t.tradeRef === ref) ??
    mockTradeByRefGlobal(ref);
  if (!trade) return null;
  if (!traderNamesMatch(trade.traderName, canonical)) return null;
  return trade;
}

/** All trades in the book (for execution desk). No seeded demo trades. */
export function mockAllTraderTrades() {
  syncBookedTradesFromDisk();
  return [...getBookedTrades()].sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime());
}

export function mockTradeByRefGlobal(tradeRef: string) {
  return mockAllTraderTrades().find((t) => t.tradeRef === tradeRef.trim()) ?? null;
}

export function mockTraderDeskSummary(traderName: string) {
  const trades = mockTraderTrades(canonicalTraderName(traderName));
  const isOpen = (s: TradeStatus) =>
    s === TradeStatus.PENDING ||
    s === TradeStatus.LOCKED ||
    s === TradeStatus.CONFIRMED ||
    s === TradeStatus.EXECUTED;
  const open = trades.filter((t) => isOpen(t.tradeStatus));
  const pending = trades.filter((t) => t.tradeStatus === TradeStatus.PENDING);
  const weekEnd = addDays(now(), 7);
  const deliveriesDue = trades.filter(
    (t) =>
      t.deliveryStart <= weekEnd &&
      (t.tradeStatus === TradeStatus.CONFIRMED || t.tradeStatus === TradeStatus.EXECUTED),
  );
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const bookedToday = trades.filter((t) => t.tradeDate >= todayStart);
  const myMtm = open.reduce((a, t) => a + t.mtmPnl, 0);

  return {
    traderName,
    desk: "AGRI_DESK",
    openTrades: open.length,
    pendingConfirmation: pending.length,
    deliveriesThisWeek: deliveriesDue.length,
    bookedToday: bookedToday.length,
    todayVolumeMt: bookedToday.reduce((a, t) => a + t.quantity, 0),
    myMtm,
    openNotional: open.reduce((a, t) => a + t.quantity * (t.pricePerCanonicalQty ?? t.price), 0),
  };
}

export function mockTraderExposure(traderName: string) {
  const trades = mockTraderTrades(canonicalTraderName(traderName)).filter(
    (t) =>
      t.tradeStatus === TradeStatus.CONFIRMED ||
      t.tradeStatus === TradeStatus.EXECUTED ||
      t.tradeStatus === TradeStatus.LOCKED ||
      t.tradeStatus === TradeStatus.PENDING,
  );
  const byCommodity = new Map<
    string,
    { code: string; name: string; long: number; short: number; mtm: number; marketPrice: number }
  >();
  for (const t of trades) {
    const cur = byCommodity.get(t.commodity.code) ?? {
      code: t.commodity.code,
      name: t.commodity.name,
      long: 0,
      short: 0,
      mtm: 0,
      marketPrice: t.marketPrice,
    };
    if (t.direction === TradeDirection.BUY) cur.long += t.quantity;
    else cur.short += t.quantity;
    cur.mtm += t.mtmPnl;
    byCommodity.set(t.commodity.code, cur);
  }
  return Array.from(byCommodity.values()).map((c) => {
    const desk = getDeskMarketPrice(c.code);
    const ref = desk?.cnf ?? desk?.yesterday;
    return {
      ...c,
      net: c.long - c.short,
      marketPrice: ref?.amount ?? c.marketPrice,
      marketCurrency: ref?.currency,
      marketUnit: ref?.unit,
    };
  });
}

export function mockTraderActionItems(traderName: string) {
  const trades = mockTraderTrades(canonicalTraderName(traderName));
  const items: { id: string; type: string; message: string; tradeRef: string; priority: "high" | "medium" | "low" }[] = [];
  for (const t of trades) {
    if (t.tradeStatus === TradeStatus.PENDING && t.pendingTraderReview) {
      items.push({
        id: `act-${t.id}-review`,
        type: "CONFIRMATION",
        message: "Review execution edits and lock trade",
        tradeRef: t.tradeRef,
        priority: "high",
      });
    } else if (t.tradeStatus === TradeStatus.PENDING && !t.submittedToExecution) {
      items.push({
        id: `act-${t.id}-pend`,
        type: "CONFIRMATION",
        message: `Submit ${t.tradeRef} to execution or send confirmation to ${t.counterparty.name}`,
        tradeRef: t.tradeRef,
        priority: "high",
      });
    }
    if (t.tradeStatus === TradeStatus.CONFIRMED && t.deliveryStart <= addDays(now(), 5)) {
      items.push({
        id: `act-${t.id}-del`,
        type: "DELIVERY",
        message: `Delivery window opens ${t.deliveryStart.toISOString().slice(0, 10)}`,
        tradeRef: t.tradeRef,
        priority: "medium",
      });
    }
  }
  return items;
}

export function mockCounterpartyOptions() {
  return getMergedCounterparties();
}

export function mockLocationOptions() {
  return getMergedLocations();
}

export function mockBookTrade(input: {
  traderName: string;
  commodityId: string;
  commodityCode: string;
  commodityName: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  direction: TradeDirection;
  quantity: number;
  quantityUnit: string;
  price?: number;
  /** Legacy hint only; the settlement currency is derived from `priceCurrency`. */
  currency?: string;
  priceBasis: string;
  deliveryStart: Date;
  deliveryEnd: Date;
  originName: string;
  destName: string;
  incoterms: string;
  paymentType: PaymentType;
  grade: string;
  productOrigin: string;
  qualityTolerances: string;
  qualityTolerancesDetail?: QualityTolerances;
  maxMoisturePct?: number | null;
  counterpartyKycStatus: KycStatus;
  counterpartyKycRef: string | null;
  counterpartyCompanyNameNtn?: string | null;
  counterpartyNtn?: string | null;
  counterpartyAddress?: string | null;
  counterpartyBankDetails?: string | null;
  notes?: string;
  tradeDate?: Date;
  creditDays?: number;
  buyingCategory?: "Delivered" | "Spot";
  tradeScope?: "LOCAL" | "INTERNATIONAL";
  ratePerMaund?: number;
  commissionPerMaund?: number;
  /** Flat broker commission in the quoted price currency. */
  commissionAmount?: number;
  /** @deprecated */
  commissionPerUnit?: number;
  priceCurrency?: PriceCurrency;
  priceWeightUnit?: string;
  priceKgPerUnit?: number;
  /** Kilograms per one canonical quantity unit for this commodity (e.g. MT → 1000). */
  canonicalKgPerUnit?: number;
  /** Original quantity before conversion to MT. */
  quantityEntered?: number;
  quantityEnteredUnit?: string;
  tradeParams?: Record<string, string | number | null>;
  /** When true, send to execution Open Trades instead of trader-only draft. */
  submitToExecution?: boolean;
}): MockTraderTrade {
  syncBookedTradesFromDisk();
  const rt = getBookedRuntime();
  rt.mockTradeSeq += 1;
  const tradeRef = `KAS-2026-${rt.mockTradeSeq}`;

  // Map the quoted price (any currency + weight unit) into the canonical quantity unit.
  const priceCurrency: PriceCurrency =
    input.priceCurrency ?? (input.currency === "PKR" ? "PKR" : "USD");
  const priceWeightUnit = input.priceWeightUnit ?? input.quantityUnit;
  const priceKgPerUnit = input.priceKgPerUnit ?? defaultKgPerUnit(priceWeightUnit);
  const canonicalKgPerUnit = input.canonicalKgPerUnit ?? defaultKgPerUnit(input.quantityUnit);
  const qtyEntered = input.quantityEntered ?? input.quantity;
  const qtyEnteredUnit = input.quantityEnteredUnit ?? input.quantityUnit;
  // Canonical storage: always MT (unit → kg → MT).
  const quantityMt = toMt(qtyEntered, qtyEnteredUnit);
  const priceMetric = { currency: priceCurrency, weightUnit: priceWeightUnit, kgPerUnit: priceKgPerUnit };
  const quotedPrice = input.price ?? 0;
  const hasQuotedPrice = quotedPrice > 0;
  const pricePerCanonicalQty = hasQuotedPrice
    ? toPricePerCanonicalQty(quotedPrice, priceMetric, canonicalKgPerUnit)
    : null;
  const commissionPerUnit =
    input.commissionPerUnit ??
    input.commissionPerMaund ??
    (input.commissionAmount != null && input.commissionAmount > 0 ? input.commissionAmount : null);
  const qtyKg = quantityMt * canonicalKgPerUnit;
  const priceDenomCount = priceKgPerUnit > 0 ? qtyKg / priceKgPerUnit : 0;
  const commissionAmount =
    commissionPerUnit != null && commissionPerUnit > 0
      ? commissionPerUnit * priceDenomCount
      : input.commissionAmount != null && input.commissionAmount > 0
        ? input.commissionAmount
        : null;
  const commissionPerMaund =
    input.commissionPerMaund ??
    (commissionPerUnit != null && /MAUND/i.test(priceWeightUnit) ? commissionPerUnit : null);
  const commissionPerCanonicalQty =
    commissionPerUnit != null && commissionPerUnit > 0
      ? toPricePerCanonicalQty(commissionPerUnit, priceMetric, canonicalKgPerUnit)
      : null;
  const baseCurrency = baseCurrencyOf(priceCurrency);

  const trade = buildTraderTrade({
    id: `tt-new-${rt.mockTradeSeq}`,
    tradeRef,
    tradeDate: input.tradeDate ?? now(),
    traderName: canonicalTraderName(input.traderName),
    desk: "AGRI_DESK",
    direction: input.direction,
    quantity: quantityMt,
    quantityUnit: "MT",
    quantityEntered: qtyEntered,
    quantityEnteredUnit: qtyEnteredUnit,
    tradeParams: input.tradeParams ?? null,
    price: hasQuotedPrice ? quotedPrice : 0,
    currency: baseCurrency,
    priceBasis: input.priceBasis,
    priceCurrency,
    priceWeightUnit,
    priceKgPerUnit,
    pricePerCanonicalQty,
    commissionAmount,
    commissionPerUnit: commissionPerUnit ?? null,
    commissionPerCanonicalQty,
    tradeStatus: TradeStatus.PENDING,
    deliveryStart: input.deliveryStart,
    deliveryEnd: input.deliveryEnd,
    originName: input.originName,
    destName: input.destName,
    incoterms: input.incoterms,
    paymentType: input.paymentType,
    paymentTerms:
      input.paymentType === "CREDIT"
        ? paymentTypeLabel("CREDIT", input.creditDays)
        : PAYMENT_TYPE_LABELS[input.paymentType] ?? paymentTypeLabel(input.paymentType),
    grade: input.grade,
    productOrigin: input.productOrigin,
    qualityTolerances: input.qualityTolerances,
    maxMoisturePct: input.maxMoisturePct,
    counterpartyKycStatus: input.counterpartyKycStatus,
    counterpartyKycRef: input.counterpartyKycRef,
    contractRef: null,
    commodity: {
      id: input.commodityId,
      code: input.commodityCode,
      name: input.commodityName,
      unit: input.quantityUnit,
    },
    counterparty: {
      id: input.counterpartyId,
      name: input.counterpartyName,
      code: input.counterpartyCode,
      companyNameNtn: input.counterpartyCompanyNameNtn ?? null,
      ntn: input.counterpartyNtn ?? null,
      address: input.counterpartyAddress ?? null,
      bankDetails: input.counterpartyBankDetails ?? null,
    },
    notes: input.notes,
    // Internal desk routing only — trades are categorized by their incoterm.
    // Only a literal "Spot" purchase routes through the spot pipeline.
    buyingCategory:
      input.buyingCategory ??
      (input.direction === TradeDirection.BUY
        ? (input.incoterms === "Spot" ? "Spot" : "Delivered")
        : null),
    tradeScope: input.tradeScope ?? "LOCAL",
    ratePerMaund: input.ratePerMaund ?? null,
    commissionPerMaund: commissionPerMaund ?? null,
    qualityTolerancesDetail:
      input.qualityTolerancesDetail ??
      ({
        ...DEFAULT_QUALITY_TOLERANCES,
        moisturePct: input.maxMoisturePct ?? DEFAULT_QUALITY_TOLERANCES.moisturePct,
      } satisfies QualityTolerances),
    submittedToExecution: input.submitToExecution === true,
    submittedToExecutionAt: input.submitToExecution === true ? now() : null,
    pendingTraderReview: false,
    pendingTraderPrice:
      input.submitToExecution === true &&
      !priceBasisRequiresQuote(input.priceBasis) &&
      !hasQuotedPrice,
  });
  upsertBookedTrade(trade);
  return trade;
}

import type { TradeDirection } from "@prisma/client";
import type {
  BuyingCategory,
  ExecutionProfile,
  QualityTolerances,
  TradeScope,
} from "@/lib/trade-constants";
import type { WarehouseAllocationLine } from "@/lib/warehouse-allocation";
import {
  EXECUTION_FILE,
  isLocalPersistEnabled,
  persistedFileMtime,
  readPersisted,
  writePersisted,
} from "@/server/local-persist";

// ─── Pending Truck (Gatepass) Types ───────────────────────────────────────────
export type PendingTruckStatus = "PENDING" | "ASSIGNED" | "PARTIAL";
export type PendingTruck = {
  id: string;
  /** Gatepass no. — the single unique gate-entry reference (truck no. can repeat). Auto-generated if not supplied. */
  gatepassNo: string;
  arrivalDate: Date;
  counterpartyName: string;
  /** @deprecated legacy persisted trucks only */
  brokerName?: string | null;
  movementType: "INBOUND" | "OUTBOUND";
  warehouseName: string;
  truckNo: string;
  transporterName?: string | null;
  transporterPhone?: string | null;
  /** @deprecated use transporterName — legacy persisted trucks only */
  driverName?: string | null;
  /** @deprecated use transporterPhone — legacy persisted trucks only */
  driverPhone?: string | null;
  /** Builty / consignment note reference and details */
  builtyDetails?: string | null;
  commodityCode?: string | null;
  commodityName?: string | null;
  /** Warehouse manager or staff who logged the gatepass */
  recordedByName?: string | null;
  /** Quantity as stated on the builty (e.g. bags, MT). */
  quantityAsPerBuilty?: string | null;
  /** Gross weight as stated on the builty (kg). Drives trade allocation weight. */
  weightAsPerBuiltyKg?: number | null;
  weighBridgeName?: string | null;
  documentRefs?: string[];
  /** Inbound warehouse weighment (kg). */
  warehouseWeightKg?: number | null;
  qualitySpecs?: QualityTolerances | null;
  quantityBagsBales?: number | null;
  totalDeductionsKg?: number | null;
  weightKg: number;
  /** @deprecated use quantityBagsBales */
  bags?: number | null;
  remarks?: string | null;
  status: PendingTruckStatus;
  assignedTradeRef?: string | null;
  assignedAt?: Date | null;
  remainingKg: number;
  /** Auto-generated purchase invoice for inbound gate entries (warehouse weight − deductions). */
  gateInvoiceNo?: string | null;
  gateInvoiceWeightKg?: number | null;
  gateInvoiceQtyMt?: number | null;
  gateInvoiceAmount?: number | null;
  gateInvoiceCurrency?: string | null;
  gateInvoiceRatePerKg?: number | null;
  /** Locked contract used for provisional gate-in invoice pricing. */
  gateInvoiceTradeRef?: string | null;
  /** @deprecated legacy persisted trucks only */
  driverCnic?: string | null;
};

export type ContractStatus = "Open" | "Close";

export type ExecutionContract = {
  tradeRef: string;
  tradeId: string;
  contractDate: Date;
  direction: TradeDirection;
  executionProfile: ExecutionProfile;
  tradeScope: TradeScope;
  /** Raw incoterm chosen by the trader (Spot/Delivered/Ex-Warehouse or standard EXW..DAP). */
  incoterms: string;
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
  /** Booked quantity tolerance in trade units (from booking form). */
  quantityToleranceMt: number;
  qualityTolerances: QualityTolerances;
  ratePerMaund: number | null;
  ratePerKg: number | null;
  /** Booked unit price at lock (quoted rate). */
  unitPrice: number | null;
  priceCurrency: string | null;
  priceWeightUnit: string | null;
  commissionPerMaund: number | null;
  currency: string;
  /** Warehouse implied by the trade's origin/destination (informational). */
  warehouseDefault: string | null;
  /** Trader's optional warehouse hint from booking (display label). */
  traderWarehouseHint: string | null;
  /** Warehouses the trader selected at booking (qty assigned by execution head). */
  traderWarehouseSelections: string[];
  /** @deprecated Use warehouseAllocations — kept for legacy persisted rows and quick display. */
  allocatedWarehouse: string | null;
  /** Split warehouse allocation (qty in trade unit, e.g. MT). Sum must equal contractualQtyMt. */
  warehouseAllocations: WarehouseAllocationLine[];
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

export type ExecutionSnapshot = {
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
  gateInvoiceSeq: number;
};

export type ExecutionRuntime = {
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
  gateInvoiceSeq: number;
};

const EXEC_RUNTIME_KEY = "__kastrosExecutionRuntime";
const EXEC_BATCH_REFRESH_KEY = "__kastrosExecutionBatchRefresh";
const EXEC_DISK_MTIME_KEY = "__kastrosExecutionDiskMtime";
const EXEC_DISK_LOADED_KEY = "__kastrosExecutionDiskLoaded";

export function isBatchRefreshingContracts(): boolean {
  return (globalThis as typeof globalThis & { [EXEC_BATCH_REFRESH_KEY]?: boolean })[
    EXEC_BATCH_REFRESH_KEY
  ] === true;
}

export function setBatchRefreshingContracts(value: boolean) {
  (globalThis as typeof globalThis & { [EXEC_BATCH_REFRESH_KEY]?: boolean })[EXEC_BATCH_REFRESH_KEY] =
    value;
}

function getDiskCacheMeta() {
  const g = globalThis as typeof globalThis & {
    [EXEC_DISK_MTIME_KEY]?: number;
    [EXEC_DISK_LOADED_KEY]?: boolean;
  };
  return g;
}

export function getExecutionRuntime(): ExecutionRuntime {
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
      gateInvoiceSeq: 0,
    };
  }
  return g[EXEC_RUNTIME_KEY];
}

/** Load execution-state.json only when missing from memory or file mtime changed. */
export function syncExecutionFromDisk(force = false): void {
  if (!isLocalPersistEnabled()) return;
  const meta = getDiskCacheMeta();
  const mtime = persistedFileMtime(EXECUTION_FILE);
  if (!force && meta[EXEC_DISK_LOADED_KEY] && meta[EXEC_DISK_MTIME_KEY] === mtime) {
    return;
  }
  const snap = readPersisted<ExecutionSnapshot>(EXECUTION_FILE);
  meta[EXEC_DISK_LOADED_KEY] = true;
  meta[EXEC_DISK_MTIME_KEY] = mtime;
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
  rt.gateInvoiceSeq = snap.gateInvoiceSeq ?? 0;
}

export function ex() {
  if (!isBatchRefreshingContracts()) syncExecutionFromDisk();
  return getExecutionRuntime();
}

export function persistExecutionState() {
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
    gateInvoiceSeq: rt.gateInvoiceSeq,
  } satisfies ExecutionSnapshot);
  const meta = getDiskCacheMeta();
  meta[EXEC_DISK_LOADED_KEY] = true;
  meta[EXEC_DISK_MTIME_KEY] = persistedFileMtime(EXECUTION_FILE);
}


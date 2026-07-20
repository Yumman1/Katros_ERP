import type {
  Prisma,
  TradeDirection,
  PendingTruck as PendingTruckRow,
  GatepassDocument as GatepassDocumentRow,
  ExecutionContract as ExecutionContractRow,
  ContractWarehouseAllocation as ContractWarehouseAllocationRow,
  InboundReceipt as InboundReceiptRow,
  OutboundDispatch as OutboundDispatchRow,
  SpotPurchaseEvent as SpotPurchaseEventRow,
  PaymentRequest as PaymentRequestRow,
} from "@prisma/client";
import {
  DEFAULT_QUALITY_TOLERANCES,
  type BuyingCategory,
  type ExecutionProfile,
  type QualityTolerances,
  type TradeScope,
} from "@/lib/trade-constants";
import type { WarehouseAllocationLine } from "@/lib/warehouse-allocation";
import type { GateInvoiceStage } from "@/lib/gate-invoice";
import { json, num, numOrNull } from "@/server/db/convert";

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
  /** Manually entered gate invoice for inbound gate entries (validated against gateInvoiceExpectedPkr). */
  gateInvoiceNo?: string | null;
  gateInvoiceWeightKg?: number | null;
  gateInvoiceQtyMt?: number | null;
  gateInvoiceAmount?: number | null;
  gateInvoiceCurrency?: string | null;
  gateInvoiceRatePerKg?: number | null;
  /** Locked contract used for provisional gate-in invoice pricing. */
  gateInvoiceTradeRef?: string | null;
  /** Workflow stage of the gate invoice (set whenever an invoice exists). */
  gateInvoiceStage?: GateInvoiceStage | null;
  /** Expected invoice amount (PKR) computed at trade assignment — net warehouse weight × contract rate. */
  gateInvoiceExpectedPkr?: number | null;
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

// ─── Prisma row ↔ runtime type mappers ────────────────────────────────────────
//
// The execution runtime now lives in Postgres. The exported types above are the
// wire shapes the whole app consumes (plain numbers, Date objects); the mappers
// below convert Prisma rows (Decimal columns, relation rows) at the boundary.

/** Standard include for pending-truck reads (uploaded gatepass documents). */
export const TRUCK_INCLUDE = {
  documents: { orderBy: { uploadedAt: "asc" as const } },
} satisfies Prisma.PendingTruckInclude;

export type PendingTruckRowWithDocs = PendingTruckRow & {
  documents?: GatepassDocumentRow[];
};

export function truckRowToRuntime(row: PendingTruckRowWithDocs): PendingTruck {
  return {
    id: row.id,
    gatepassNo: row.gatepassNo,
    arrivalDate: row.arrivalDate,
    counterpartyName: row.counterpartyName,
    brokerName: null,
    movementType: row.movementType,
    warehouseName: row.warehouseName,
    truckNo: row.truckNo,
    transporterName: row.transporterName,
    transporterPhone: row.transporterPhone,
    driverName: null,
    driverPhone: null,
    builtyDetails: row.builtyDetails,
    commodityCode: row.commodityCode,
    commodityName: row.commodityName,
    recordedByName: row.recordedByName,
    quantityAsPerBuilty: row.quantityAsPerBuilty,
    weightAsPerBuiltyKg: numOrNull(row.weightAsPerBuiltyKg),
    weighBridgeName: row.weighBridgeName,
    documentRefs: (row.documents ?? []).map((d) => d.storagePath),
    warehouseWeightKg: numOrNull(row.warehouseWeightKg),
    qualitySpecs: json<QualityTolerances>(row.qualitySpecs),
    quantityBagsBales: row.quantityBagsBales,
    totalDeductionsKg: numOrNull(row.totalDeductionsKg),
    weightKg: num(row.weightKg),
    bags: row.quantityBagsBales,
    remarks: row.remarks,
    status: row.status,
    assignedTradeRef: row.assignedTradeRef,
    assignedAt: row.assignedAt,
    remainingKg: num(row.remainingKg),
    gateInvoiceNo: row.gateInvoiceNo,
    gateInvoiceWeightKg: numOrNull(row.gateInvoiceWeightKg),
    gateInvoiceQtyMt: numOrNull(row.gateInvoiceQtyMt),
    gateInvoiceAmount: numOrNull(row.gateInvoiceAmount),
    gateInvoiceCurrency: row.gateInvoiceCurrency,
    gateInvoiceRatePerKg: numOrNull(row.gateInvoiceRatePerKg),
    gateInvoiceTradeRef: row.gateInvoiceTradeRef,
    gateInvoiceStage: row.gateInvoiceStage,
    gateInvoiceExpectedPkr: numOrNull(row.gateInvoiceExpectedPkr),
    driverCnic: null,
  };
}

/** Standard include for contract reads (split warehouse allocations). */
export const CONTRACT_INCLUDE = {
  warehouseAllocations: { orderBy: { warehouseName: "asc" as const } },
} satisfies Prisma.ExecutionContractInclude;

export type ExecutionContractRowWithAllocations = ExecutionContractRow & {
  warehouseAllocations: ContractWarehouseAllocationRow[];
};

export function contractRowToRuntime(row: ExecutionContractRowWithAllocations): ExecutionContract {
  return {
    tradeRef: row.tradeRef,
    tradeId: row.tradeId,
    contractDate: row.contractDate,
    direction: row.direction,
    executionProfile: row.executionProfile,
    tradeScope: row.tradeScope,
    incoterms: row.incoterms,
    buyingCategory: row.buyingCategory ?? null,
    commodityCode: row.commodityCode,
    commodityName: row.commodityName,
    counterpartyName: row.counterpartyName,
    counterpartyCode: row.counterpartyCode,
    counterpartyNtn: row.counterpartyNtn,
    quantityUnit: row.quantityUnit,
    contractualQtyMt: num(row.contractualQtyMt),
    receivedQtyMt: num(row.receivedQtyMt),
    openQtyMt: num(row.openQtyMt),
    contractStatus: row.contractStatus,
    quantityToleranceMt: num(row.quantityToleranceMt),
    qualityTolerances: json<QualityTolerances>(row.qualityTolerances) ?? DEFAULT_QUALITY_TOLERANCES,
    ratePerMaund: numOrNull(row.ratePerMaund),
    ratePerKg: numOrNull(row.ratePerKg),
    unitPrice: numOrNull(row.unitPrice),
    priceCurrency: row.priceCurrency,
    priceWeightUnit: row.priceWeightUnit,
    commissionPerMaund: numOrNull(row.commissionPerMaund),
    currency: row.currency,
    warehouseDefault: row.warehouseDefault,
    traderWarehouseHint: row.traderWarehouseHint,
    traderWarehouseSelections: row.traderWarehouseSelections,
    allocatedWarehouse: row.allocatedWarehouse,
    warehouseAllocations: row.warehouseAllocations.map((a) => ({
      warehouseName: a.warehouseName,
      qtyMt: num(a.qtyMt),
      fulfilledQtyMt: num(a.fulfilledQtyMt),
      // openQtyMt is derived, never stored.
      openQtyMt: Math.max(0, num(a.qtyMt) - num(a.fulfilledQtyMt)),
    })),
    traderName: row.traderName,
    lockedAt: row.lockedAt,
    lockedBy: row.lockedBy,
    deliveryStart: row.deliveryStart,
    deliveryEnd: row.deliveryEnd,
  };
}

/** Include the linked payment request so the runtime shape can expose its business ref. */
export const INBOUND_INCLUDE = {
  paymentRequest: { select: { requestRef: true } },
} satisfies Prisma.InboundReceiptInclude;

export type InboundReceiptRowWithPayment = InboundReceiptRow & {
  paymentRequest?: { requestRef: string } | null;
};

export function inboundRowToRuntime(row: InboundReceiptRowWithPayment): InboundReceipt {
  return {
    id: row.id,
    gatepassNo: row.gatepassNo,
    kcsNo: row.kcsNo,
    receiveDate: row.receiveDate,
    truckNo: row.truckNo,
    driverName: row.driverName,
    driverCnic: row.driverCnic,
    driverPhone: row.driverPhone,
    biltyNo: row.biltyNo,
    trnNo: row.trnNo,
    warehouseName: row.warehouseName,
    sellerName: row.sellerName,
    tradeRef: row.tradeRef,
    billNo: row.billNo,
    bags: row.bags,
    weightSpotKg: num(row.weightSpotKg),
    weightWarehouseKg: num(row.weightWarehouseKg),
    weightDiffKg: num(row.weightDiffKg),
    qualityReadings: {
      damagePct: num(row.damagePct),
      brokenPct: num(row.brokenPct),
      fungusPct: num(row.fungusPct),
      foreignMatterPct: num(row.foreignMatterPct),
      moisturePct: num(row.moisturePct),
    },
    deductionPct: num(row.deductionPct),
    allocatedQtyMt: num(row.allocatedQtyMt),
    fifoOverrideReason: row.fifoOverrideReason,
    amountDue: num(row.amountDue),
    status: row.status,
    // UI-facing payment reference is the business requestRef, not the DB cuid.
    paymentRequestId: row.paymentRequest?.requestRef ?? null,
    documentRefs: row.documentRefs,
    remarks: row.remarks,
  };
}

export const OUTBOUND_INCLUDE = {
  paymentRequest: { select: { requestRef: true } },
} satisfies Prisma.OutboundDispatchInclude;

export type OutboundDispatchRowWithPayment = OutboundDispatchRow & {
  paymentRequest?: { requestRef: string } | null;
};

export function outboundRowToRuntime(row: OutboundDispatchRowWithPayment): OutboundDispatch {
  return {
    id: row.id,
    gatepassNo: row.gatepassNo,
    dispatchDate: row.dispatchDate,
    liftedBy: row.liftedBy,
    buyerName: row.buyerName,
    tradeRef: row.tradeRef,
    warehouseName: row.warehouseName,
    truckNo: row.truckNo,
    driverName: row.driverName,
    driverCnic: row.driverCnic,
    driverPhone: row.driverPhone,
    dispatchWeightKg: num(row.dispatchWeightKg),
    invoiceWeightKg: num(row.invoiceWeightKg),
    fungusPct: num(row.fungusPct),
    doRef: row.doRef,
    fifoOverrideReason: row.fifoOverrideReason,
    allocatedQtyMt: num(row.allocatedQtyMt),
    amountDue: num(row.amountDue),
    status: row.status,
    paymentRequestId: row.paymentRequest?.requestRef ?? null,
    documentRefs: row.documentRefs,
    remarks: row.remarks,
  };
}

export const SPOT_INCLUDE = {
  paymentRequest: { select: { requestRef: true } },
} satisfies Prisma.SpotPurchaseEventInclude;

export type SpotPurchaseEventRowWithPayment = SpotPurchaseEventRow & {
  paymentRequest?: { requestRef: string } | null;
};

export function spotRowToRuntime(row: SpotPurchaseEventRowWithPayment): SpotPurchaseEvent {
  return {
    id: row.id,
    tradeRef: row.tradeRef,
    state: row.state,
    selectorNotes: row.selectorNotes,
    brokerName: row.brokerName,
    dcNo: row.dcNo,
    truckNo: row.truckNo,
    spotWeightKg: numOrNull(row.spotWeightKg),
    brokerInvoiceRef: row.brokerInvoiceRef,
    invoiceAmount: numOrNull(row.invoiceAmount),
    warehouseReceiveWeightKg: numOrNull(row.warehouseReceiveWeightKg),
    weightVarianceKg: numOrNull(row.weightVarianceKg),
    paymentRequestId: row.paymentRequest?.requestRef ?? null,
  };
}

export function paymentRowToRuntime(row: PaymentRequestRow): PaymentRequest {
  return {
    // Runtime id is the business requestRef ("pay-7") — the DB cuid stays internal.
    id: row.requestRef,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    tradeRef: row.tradeRef,
    counterpartyName: row.counterpartyName,
    amount: num(row.amount),
    currency: row.currency,
    status: row.status,
    financeComment: row.financeComment,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
  };
}

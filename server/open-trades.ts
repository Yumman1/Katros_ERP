import { TradeDirection, TradeStatus } from "@prisma/client";
import type { KycStatus, QualityTolerances } from "@/lib/trade-constants";
import {
  buyingCategoryFromIncoterms,
  executionProfileFromTrade,
  formatQualityTolerancesSummary,
  PAYMENT_TYPE_LABELS,
  paymentTypeLabel,
  priceBasisRequiresQuote,
  tradeHasQuotedPrice,
  tradeScopeFromSeed,
} from "@/lib/trade-constants";
import {
  baseCurrencyOf,
  defaultKgPerUnit,
  toPricePerCanonicalQty,
  type PriceCurrency,
} from "@/lib/price-units";
import { toMt } from "@/lib/unit-registry";
import {
  allocationsSumMatchesContract,
  EXECUTION_WAREHOUSE_SPLIT_KEY,
  parseExecutionWarehouseSplit,
  parseTraderWarehouseSelections,
  serializeExecutionWarehouseSplit,
  serializeTraderWarehouseSelections,
  type WarehouseOpenAllocationLine,
} from "@/lib/warehouse-allocation";
import {
  mockAllTraderTrades,
  mockTradeByRefGlobal,
  upsertBookedTrade,
  type MockTraderTrade,
} from "@/server/dummy-data";
import { lockTradeInStore, syncAllLockedContracts } from "@/server/execution-store";
import type { PaymentType } from "@/server/dummy-data";
import { updateCustomCounterparty } from "@/server/trader-master-data";
import { appendTradeActivity, recordTradeEditApplied } from "@/server/trade-activity";
import { traderNamesMatch, canonicalTraderName } from "@/lib/trader-identity";

export type OpenTradeSummary = {
  tradeRef: string;
  tradeDate: Date;
  traderName: string;
  direction: TradeDirection;
  commodityCode: string;
  commodityName: string;
  quantity: number;
  quantityUnit: string;
  counterpartyName: string;
  counterpartyCode: string;
  counterpartyKycStatus: KycStatus;
  counterpartyNtn: string | null;
  incoterms: string;
  buyingCategory: MockTraderTrade["buyingCategory"];
  tradeScope: MockTraderTrade["tradeScope"];
  expectedProfile: string;
  pendingTraderReview: boolean;
  pendingTraderPrice: boolean;
  submittedToExecutionAt: Date | null;
  executionLastEditedBy: string | null;
  executionLastEditedAt: Date | null;
  requiresWarehouse: boolean;
  warehouseSplitApproved: boolean;
  pendingWarehouseApproval: boolean;
};

export type OpenTradeCounterpartyPatch = {
  name?: string;
  companyNameNtn?: string | null;
  ntn?: string | null;
  address?: string | null;
  bankDetails?: string | null;
  /** Execution head confirms name & NTN against portal. */
  verify?: boolean;
};

/** Price and quantity are trader-owned — execution must not mutate these. */
const EXECUTION_FORBIDDEN_PATCH_KEYS = [
  "quantityEntered",
  "quantityEnteredUnit",
  "price",
  "priceCurrency",
  "priceWeightUnit",
  "priceKgPerUnit",
  "priceBasis",
  "commissionAmount",
] as const satisfies readonly (keyof OpenTradePatch)[];

export function stripExecutionForbiddenPatch(patch: OpenTradePatch): OpenTradePatch {
  const out = { ...patch };
  for (const key of EXECUTION_FORBIDDEN_PATCH_KEYS) {
    delete out[key];
  }
  return out;
}

export function normalizeOpenTradePatch(payload: Record<string, unknown>): OpenTradePatch {
  const patch = { ...payload } as OpenTradePatch;
  if (typeof patch.deliveryStart === "string") patch.deliveryStart = new Date(patch.deliveryStart);
  if (typeof patch.deliveryEnd === "string") patch.deliveryEnd = new Date(patch.deliveryEnd);
  return patch;
}

export type OpenTradePatch = {
  quantityEntered?: number;
  quantityEnteredUnit?: string;
  price?: number;
  priceCurrency?: PriceCurrency;
  priceWeightUnit?: string;
  priceKgPerUnit?: number;
  priceBasis?: string;
  commissionAmount?: number | null;
  deliveryStart?: Date;
  deliveryEnd?: Date;
  originName?: string;
  destName?: string;
  productOrigin?: string;
  grade?: string;
  incoterms?: string;
  paymentType?: PaymentType;
  creditDays?: number;
  notes?: string | null;
  qualityTolerances?: string;
  qualityTolerancesDetail?: QualityTolerances;
  maxMoisturePct?: number | null;
  tradeParams?: Record<string, string | number | null>;
  warehouseSelections?: string[];
  warehouseSplit?: WarehouseOpenAllocationLine[];
  executionEditNote?: string | null;
  counterparty?: OpenTradeCounterpartyPatch;
};

function isOpenTrade(t: MockTraderTrade): boolean {
  return (
    t.tradeStatus === TradeStatus.PENDING &&
    t.submittedToExecution === true &&
    // Trades awaiting or granted direct settlement are frozen out of the
    // execution review/lock flow — they never go to delivery.
    t.settlementRequested !== true &&
    t.directSettled !== true
  );
}

function assertOpenTrade(t: MockTraderTrade, tradeRef: string): void {
  if (!t) throw new Error("Trade not found: " + tradeRef);
  if (!isOpenTrade(t)) {
    throw new Error("Trade is not in Draft Trades (must be PENDING and submitted to execution)");
  }
}

function toSummary(t: MockTraderTrade): OpenTradeSummary {
  return {
    tradeRef: t.tradeRef,
    tradeDate: t.tradeDate,
    traderName: t.traderName,
    direction: t.direction,
    commodityCode: t.commodity.code,
    commodityName: t.commodity.name,
    quantity: t.quantity,
    quantityUnit: t.quantityUnit ?? t.commodity.unit,
    counterpartyName: t.counterparty.name,
    counterpartyCode: t.counterparty.code,
    counterpartyKycStatus: t.counterpartyKycStatus,
    counterpartyNtn: t.counterparty.ntn ?? null,
    incoterms: t.incoterms,
    buyingCategory: t.buyingCategory,
    tradeScope: t.tradeScope ?? tradeScopeFromSeed(t.tradeRef),
    expectedProfile: executionProfileFromTrade(t.direction, t.buyingCategory, t.incoterms),
    pendingTraderReview: t.pendingTraderReview === true,
    pendingTraderPrice: t.pendingTraderPrice === true,
    submittedToExecutionAt: t.submittedToExecutionAt ?? null,
    executionLastEditedBy: t.executionLastEditedBy ?? null,
    executionLastEditedAt: t.executionLastEditedAt ?? null,
    requiresWarehouse: openTradeRequiresWarehouse(t),
    warehouseSplitApproved: t.warehouseSplitApproved === true,
    pendingWarehouseApproval: t.pendingWarehouseApproval === true,
  };
}

export async function getOpenTradesForExecution(): Promise<OpenTradeSummary[]> {
  return (await mockAllTraderTrades())
    .filter(isOpenTrade)
    .sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime())
    .map(toSummary);
}

export async function getOpenTradeByRef(
  tradeRef: string,
): Promise<(MockTraderTrade & { expectedProfile: string }) | null> {
  const t = await mockTradeByRefGlobal(tradeRef.trim());
  if (!t || !isOpenTrade(t)) return null;
  return {
    ...t,
    expectedProfile: executionProfileFromTrade(t.direction, t.buyingCategory, t.incoterms),
  };
}

export async function submitTradeToExecution(
  tradeRef: string,
  /** Acting trader — must own the trade (CEO/ADMIN callers pass null). */
  traderName?: string | null,
): Promise<MockTraderTrade> {
  const t = await mockTradeByRefGlobal(tradeRef.trim());
  if (!t) throw new Error("Trade not found");
  if (
    traderName != null &&
    !traderNamesMatch(t.traderName, canonicalTraderName(traderName))
  ) {
    throw new Error("You can only submit your own trades to execution");
  }
  if (t.settlementRequested === true || t.directSettled === true) {
    throw new Error(
      "This trade is in direct settlement — it cannot be submitted to execution",
    );
  }
  if (t.tradeStatus !== TradeStatus.PENDING) {
    throw new Error("Only draft trades can be submitted to execution");
  }
  if (t.submittedToExecution) return t;
  t.submittedToExecution = true;
  t.submittedToExecutionAt = new Date();
  if (!priceBasisRequiresQuote(t.priceBasis) && !tradeHasQuotedPrice(t)) {
    t.pendingTraderPrice = true;
  }
  await upsertBookedTrade(t);
  return t;
}

async function applyCounterpartyPatch(
  trade: MockTraderTrade,
  patch: OpenTradeCounterpartyPatch,
): Promise<void> {
  const cp = trade.counterparty;
  if (patch.name != null) {
    const name = patch.name.trim();
    if (!name) throw new Error("Counterparty name is required");
    cp.name = name;
  }
  if (patch.companyNameNtn !== undefined) cp.companyNameNtn = patch.companyNameNtn?.trim() || null;
  if (patch.ntn !== undefined) cp.ntn = patch.ntn?.trim() || null;
  if (patch.address !== undefined) cp.address = patch.address?.trim() || null;
  if (patch.bankDetails !== undefined) cp.bankDetails = patch.bankDetails?.trim() || null;

  const masterPatch = {
    name: cp.name,
    companyNameNtn: cp.companyNameNtn ?? null,
    ntn: cp.ntn ?? null,
    address: cp.address ?? null,
    bankDetails: cp.bankDetails ?? null,
  };

  if (patch.verify) {
    const verifiedAt = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    trade.counterpartyKycStatus = "VERIFIED";
    trade.counterpartyKycRef = trade.counterpartyKycRef ?? `KYC-${cp.code}-${verifiedAt}`;
    if (cp.id.startsWith("ccp-")) {
      await updateCustomCounterparty(cp.id, {
        ...masterPatch,
        kycStatus: "VERIFIED",
        kycRef: trade.counterpartyKycRef,
      });
    }
    return;
  }

  if (cp.id.startsWith("ccp-")) {
    await updateCustomCounterparty(cp.id, masterPatch);
  }
}

async function applyPatchToTrade(
  trade: MockTraderTrade,
  patch: OpenTradePatch,
  meta: { editedBy: string; notifyTrader: boolean; editNote?: string | null },
): Promise<MockTraderTrade> {
  if (patch.quantityEntered != null && patch.quantityEnteredUnit) {
    trade.quantityEntered = patch.quantityEntered;
    trade.quantityEnteredUnit = patch.quantityEnteredUnit;
    trade.quantity = toMt(patch.quantityEntered, patch.quantityEnteredUnit);
    trade.quantityUnit = "MT";
  }

  if (patch.price != null) {
    trade.price = patch.price;
    const priceCurrency = patch.priceCurrency ?? trade.priceCurrency ?? "USD";
    const priceWeightUnit = patch.priceWeightUnit ?? trade.priceWeightUnit ?? trade.quantityUnit;
    // When the quoted weight unit CHANGES, the stored kg factor belongs to the
    // OLD unit — re-derive it from the new unit (a maund edit on an MT-quoted
    // trade must map with 40 kg, not 1000 kg, or every downstream rate,
    // expected invoice, receivable and ledger debit is corrupted).
    const unitChanged =
      patch.priceWeightUnit != null && patch.priceWeightUnit !== trade.priceWeightUnit;
    const priceKgPerUnit =
      patch.priceKgPerUnit ??
      (unitChanged ? defaultKgPerUnit(priceWeightUnit) : undefined) ??
      trade.priceKgPerUnit ??
      defaultKgPerUnit(priceWeightUnit);
    const canonicalKg = defaultKgPerUnit(trade.quantityUnit ?? "MT");
    trade.priceCurrency = priceCurrency;
    trade.priceWeightUnit = priceWeightUnit;
    trade.priceKgPerUnit = priceKgPerUnit;
    trade.currency = baseCurrencyOf(priceCurrency);
    trade.pricePerCanonicalQty = toPricePerCanonicalQty(
      patch.price,
      { currency: priceCurrency, weightUnit: priceWeightUnit, kgPerUnit: priceKgPerUnit },
      canonicalKg,
    );
  }

  if (patch.priceBasis != null) trade.priceBasis = patch.priceBasis;
  if (patch.commissionAmount !== undefined) {
    trade.commissionAmount =
      patch.commissionAmount != null && patch.commissionAmount > 0 ? patch.commissionAmount : null;
  }
  if (patch.deliveryStart != null) trade.deliveryStart = patch.deliveryStart;
  if (patch.deliveryEnd != null) trade.deliveryEnd = patch.deliveryEnd;
  if (patch.originName != null) trade.originName = patch.originName;
  if (patch.destName != null) trade.destName = patch.destName;
  if (patch.productOrigin != null) trade.productOrigin = patch.productOrigin;
  if (patch.grade != null) trade.grade = patch.grade;
  if (patch.incoterms != null) {
    trade.incoterms = patch.incoterms;
    trade.buyingCategory =
      trade.direction === TradeDirection.BUY
        ? (buyingCategoryFromIncoterms(patch.incoterms, trade.direction) ?? trade.buyingCategory ?? "Delivered")
        : null;
  }
  if (patch.paymentType != null) {
    trade.paymentType = patch.paymentType;
    const creditDays = patch.creditDays;
    trade.paymentTerms =
      patch.paymentType === "CREDIT"
        ? paymentTypeLabel("CREDIT", creditDays)
        : PAYMENT_TYPE_LABELS[patch.paymentType] ?? paymentTypeLabel(patch.paymentType);
  }
  if (patch.notes !== undefined) trade.notes = patch.notes ?? undefined;
  if (patch.qualityTolerances != null) trade.qualityTolerances = patch.qualityTolerances;
  if (patch.qualityTolerancesDetail != null) {
    trade.qualityTolerancesDetail = patch.qualityTolerancesDetail;
    trade.maxMoisturePct = patch.qualityTolerancesDetail.moisturePct;
    if (!patch.qualityTolerances) {
      trade.qualityTolerances = formatQualityTolerancesSummary(patch.qualityTolerancesDetail);
    }
  }
  if (patch.maxMoisturePct !== undefined) trade.maxMoisturePct = patch.maxMoisturePct;

  const nextParams = { ...(trade.tradeParams ?? {}), ...(patch.tradeParams ?? {}) };
  if (patch.creditDays != null && patch.paymentType === "CREDIT") {
    nextParams.creditDays = patch.creditDays;
  }
  if (patch.warehouseSelections != null) {
    if (patch.warehouseSelections.length) {
      nextParams.warehouseSelections = serializeTraderWarehouseSelections(patch.warehouseSelections);
    } else {
      delete nextParams.warehouseSelections;
    }
    delete nextParams.warehouse;
  }
  if (patch.warehouseSplit != null) {
    if (patch.warehouseSplit.length) {
      nextParams[EXECUTION_WAREHOUSE_SPLIT_KEY] = serializeExecutionWarehouseSplit(patch.warehouseSplit);
    } else {
      delete nextParams[EXECUTION_WAREHOUSE_SPLIT_KEY];
    }
    // Warehouse qty split always requires explicit head approval — never auto-approve here.
  }
  trade.tradeParams = Object.keys(nextParams).length ? nextParams : null;

  if (patch.counterparty) {
    await applyCounterpartyPatch(trade, patch.counterparty);
  }

  if (meta.notifyTrader) {
    trade.pendingTraderReview = true;
    trade.executionLastEditedBy = meta.editedBy;
    trade.executionLastEditedAt = new Date();
    if (meta.editNote !== undefined) trade.executionEditNote = meta.editNote;
  }

  await upsertBookedTrade(trade);
  return trade;
}

export async function updateOpenTradeDirect(
  tradeRef: string,
  patch: OpenTradePatch,
  editedBy: string,
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  assertOpenTrade(trade!, tradeRef);
  const safePatch = stripExecutionForbiddenPatch(patch);
  // Warehouse qty split must go through approveOpenTradeWarehouseSplit or a head-approved change request.
  delete safePatch.warehouseSplit;
  const result = await applyPatchToTrade(trade!, safePatch, {
    editedBy,
    notifyTrader: true,
    editNote: safePatch.executionEditNote ?? null,
  });
  await recordTradeEditApplied(tradeRef, safePatch, {
    actorName: editedBy,
    actorSide: "EXECUTION",
    requiresApproval: false,
    note: safePatch.executionEditNote ?? null,
  });
  return result;
}

/** Trader direct edit while still a draft (not submitted to execution). */
export async function updateTraderDraftTrade(
  traderName: string,
  tradeRef: string,
  patch: OpenTradePatch,
  editedBy: string,
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  if (!trade) throw new Error("Trade not found");
  if (trade.settlementRequested === true || trade.directSettled === true) {
    throw new Error("This trade is in direct settlement — it cannot be edited");
  }
  if (trade.tradeStatus !== TradeStatus.PENDING || trade.submittedToExecution) {
    throw new Error("Only trader drafts (not yet submitted to execution) can be edited directly");
  }
  if (!traderNamesMatch(trade.traderName, canonicalTraderName(traderName))) {
    throw new Error("You can only edit your own trades");
  }
  const normalized = normalizeOpenTradePatch(patch as Record<string, unknown>);
  const result = await applyPatchToTrade(trade, normalized, {
    editedBy,
    notifyTrader: false,
  });
  if (normalized.price != null && normalized.price > 0) {
    result.pendingTraderPrice = false;
  }
  await upsertBookedTrade(result);
  await recordTradeEditApplied(tradeRef, normalized, {
    actorName: editedBy,
    actorSide: "TRADER",
    requiresApproval: false,
  });
  return result;
}

/**
 * Cancel a trade before it is locked. Terminal: a cancelled trade leaves the
 * execution queue (see `isOpenTrade`) and can no longer be edited or locked.
 */
export async function cancelTraderTrade(
  traderName: string,
  tradeRef: string,
  reason: string,
  cancelledBy: string,
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  if (!trade) throw new Error("Trade not found");
  if (trade.tradeStatus === TradeStatus.CANCELLED) {
    throw new Error("This trade is already cancelled");
  }
  if (trade.settlementRequested === true || trade.directSettled === true) {
    throw new Error("This trade is in direct settlement — cancel the settlement request first");
  }
  // The hard gate: cancellation is only possible before execution locks the trade.
  if (trade.tradeStatus !== TradeStatus.PENDING) {
    throw new Error(
      "Only trades that are not yet locked can be cancelled — this trade is already locked",
    );
  }
  if (!traderNamesMatch(trade.traderName, canonicalTraderName(traderName))) {
    throw new Error("You can only cancel your own trades");
  }

  const trimmedReason = reason.trim();
  const result: MockTraderTrade = {
    ...trade,
    tradeStatus: TradeStatus.CANCELLED,
    // Drop it out of any execution review queue it was sitting in.
    submittedToExecution: false,
    pendingTraderReview: false,
    pendingTraderPrice: false,
    pendingWarehouseApproval: false,
  };
  await upsertBookedTrade(result);
  await appendTradeActivity(trade.tradeRef, {
    actorName: cancelledBy,
    actorSide: "TRADER",
    kind: "CANCELLED",
    requiresApproval: false,
    summary: `Trade cancelled — ${trimmedReason}`,
    note: trimmedReason,
  });
  return result;
}

/** Apply an approved change-request payload to an open trade. */
export async function applyOpenTradeEditFromPayload(
  tradeRef: string,
  payload: Record<string, unknown>,
  editedBy: string,
): Promise<MockTraderTrade> {
  const patch = stripExecutionForbiddenPatch(normalizeOpenTradePatch(payload));
  return updateOpenTradeDirect(tradeRef, patch, editedBy);
}

/** Apply a CEO-approved trader edit — does not notify trader for re-review. */
export async function applyTraderTradeEditFromPayload(
  tradeRef: string,
  payload: Record<string, unknown>,
  editedBy: string,
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  if (!trade) throw new Error("Trade not found");
  if (trade.tradeStatus !== TradeStatus.PENDING) {
    throw new Error(
      "Only draft or draft trades can be edited — locked contracts cannot change price or quantity",
    );
  }
  const patch = normalizeOpenTradePatch(payload);
  const result = await applyPatchToTrade(trade, patch, {
    editedBy,
    notifyTrader: false,
  });
  if (patch.price != null && patch.price > 0) {
    result.pendingTraderPrice = false;
  }
  await upsertBookedTrade(result);
  await recordTradeEditApplied(tradeRef, patch, {
    actorName: editedBy,
    actorSide: "CEO",
    requiresApproval: true,
  });
  return result;
}

export function assertPriceReadyForLock(trade: MockTraderTrade): void {
  if (trade.pendingTraderPrice) {
    throw new Error(
      "Trader must enter the contract price from My Trades before this trade can be locked",
    );
  }
  if (priceBasisRequiresQuote(trade.priceBasis) && !tradeHasQuotedPrice(trade)) {
    throw new Error("Trade is missing a fixed price");
  }
}

export async function completeTraderTradePrice(
  traderName: string,
  tradeRef: string,
  input: {
    price: number;
    commissionPerUnit?: number;
    priceCurrency?: PriceCurrency;
    priceWeightUnit?: string;
    priceKgPerUnit?: number;
  },
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  if (!trade) throw new Error("Trade not found");
  if (trade.tradeStatus !== TradeStatus.PENDING) {
    throw new Error("Only pending trades can be updated");
  }
  if (!trade.submittedToExecution) {
    throw new Error("Trade has not been submitted to execution");
  }
  if (!trade.pendingTraderPrice && tradeHasQuotedPrice(trade)) {
    throw new Error("This trade already has a price");
  }
  if (input.price <= 0) throw new Error("Enter a valid price");

  const priceCurrency = input.priceCurrency ?? trade.priceCurrency ?? "PKR";
  const priceWeightUnit = input.priceWeightUnit ?? trade.priceWeightUnit ?? trade.quantityUnit ?? "MT";
  const priceKgPerUnit = input.priceKgPerUnit ?? trade.priceKgPerUnit ?? defaultKgPerUnit(priceWeightUnit);
  const canonicalKg = defaultKgPerUnit(trade.quantityUnit ?? "MT");
  const priceMetric = { currency: priceCurrency, weightUnit: priceWeightUnit, kgPerUnit: priceKgPerUnit };

  trade.price = input.price;
  trade.priceCurrency = priceCurrency;
  trade.priceWeightUnit = priceWeightUnit;
  trade.priceKgPerUnit = priceKgPerUnit;
  trade.currency = baseCurrencyOf(priceCurrency);
  trade.pricePerCanonicalQty = toPricePerCanonicalQty(input.price, priceMetric, canonicalKg);

  const commissionPerUnit = input.commissionPerUnit ?? trade.commissionPerUnit ?? null;
  if (commissionPerUnit != null && commissionPerUnit >= 0) {
    trade.commissionPerUnit = commissionPerUnit;
    const qtyKg = trade.quantity * canonicalKg;
    const priceDenomCount = priceKgPerUnit > 0 ? qtyKg / priceKgPerUnit : 0;
    trade.commissionAmount =
      commissionPerUnit > 0 && priceDenomCount > 0 ? commissionPerUnit * priceDenomCount : null;
    trade.commissionPerCanonicalQty =
      commissionPerUnit > 0
        ? toPricePerCanonicalQty(commissionPerUnit, priceMetric, canonicalKg)
        : null;
  }

  trade.pendingTraderPrice = false;
  await upsertBookedTrade(trade);
  // Defensive: if this trade is somehow already locked with linked trucks,
  // the new price must ripple into their expected amounts + ledger debits.
  {
    const { recomputeTradeLinkedAmounts } = await import("@/server/execution/recompute");
    await recomputeTradeLinkedAmounts(trade.tradeRef);
  }
  return trade;
}

export async function lockOpenTradeFromExecution(
  tradeRef: string,
  lockedBy: string,
  patch?: OpenTradePatch,
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  assertOpenTrade(trade!, tradeRef);
  if (trade!.pendingTraderReview) {
    throw new Error(
      "This trade has execution edits awaiting trader review. The trader must lock it after reviewing.",
    );
  }
  if (patch && Object.keys(patch).length > 0) {
    await applyPatchToTrade(trade!, stripExecutionForbiddenPatch(patch), {
      editedBy: lockedBy,
      notifyTrader: false,
    });
  }
  const refreshed = await mockTradeByRefGlobal(tradeRef.trim());
  assertPriceReadyForLock(refreshed!);
  assertWarehouseReadyForLock(refreshed!);
  return lockTradeInStore(refreshed!.traderName, tradeRef, { lockedBy });
}

export async function lockOpenTradeAfterTraderReview(
  traderName: string,
  tradeRef: string,
  input: {
    lockedBy: string;
    ratePerMaund?: number;
    commissionPerMaund?: number;
    qualityTolerances?: QualityTolerances;
  },
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  if (!trade) throw new Error("Trade not found");
  if (!isOpenTrade(trade)) {
    throw new Error("Trade is not in Draft Trades");
  }
  if (!trade.pendingTraderReview) {
    throw new Error("No execution edits to acknowledge — execution can lock this trade directly");
  }
  // Asserts FIRST — a failed lock must not silently count as trader approval.
  assertPriceReadyForLock(trade);
  assertWarehouseReadyForLock(trade);
  trade.pendingTraderReview = false;
  await upsertBookedTrade(trade);
  return lockTradeInStore(traderName, tradeRef, input);
}

export async function getPendingTraderReviewTrades(): Promise<OpenTradeSummary[]> {
  return (await getOpenTradesForExecution()).filter((t) => t.pendingTraderReview);
}

/**
 * Trader approves execution's edits on their trade (from the Approvals page)
 * WITHOUT locking it — clears pendingTraderReview so execution can lock the
 * contract from their side.
 */
export async function traderApproveExecutionEdits(
  traderName: string,
  tradeRef: string,
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  if (!trade) throw new Error("Trade not found");
  if (!traderNamesMatch(trade.traderName, canonicalTraderName(traderName))) {
    throw new Error("You can only approve changes on your own trades");
  }
  if (!trade.pendingTraderReview) {
    throw new Error("No execution changes awaiting your approval on this trade");
  }
  trade.pendingTraderReview = false;
  await upsertBookedTrade(trade);
  await appendTradeActivity(tradeRef, {
    actorName: traderName,
    actorSide: "TRADER",
    kind: "EDIT_APPROVED",
    requiresApproval: false,
    summary: "Trader approved execution changes — trade can be locked by execution",
    note: trade.executionEditNote ?? null,
  });
  return trade;
}

/** Whether this trade profile uses warehouse allocation on lock. */
export function openTradeRequiresWarehouse(trade: MockTraderTrade): boolean {
  const profile = executionProfileFromTrade(trade.direction, trade.buyingCategory, trade.incoterms);
  return profile === "PURCHASE_DELIVERED" || profile === "SALE_EX_WAREHOUSE";
}

export function validateWarehouseSplitForTrade(
  trade: MockTraderTrade,
  split?: WarehouseOpenAllocationLine[],
): { ok: true } | { ok: false; message: string } {
  if (!openTradeRequiresWarehouse(trade)) return { ok: true };

  const plan = split ?? parseExecutionWarehouseSplit(trade.tradeParams);
  if (!plan.length) {
    return {
      ok: false,
      message: "Allocate the full contract quantity across warehouses before locking",
    };
  }

  const seen = new Set<string>();
  for (const line of plan) {
    const name = line.warehouseName.trim();
    if (!name) {
      return { ok: false, message: "Every warehouse line must have a warehouse selected" };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, message: `Duplicate warehouse "${name}" in allocation split` };
    }
    seen.add(key);
    if (!(line.openQtyMt > 0)) {
      return { ok: false, message: `Enter a quantity for ${name}` };
    }
  }

  const sum = plan.reduce((s, l) => s + l.openQtyMt, 0);
  const unit = trade.quantityUnit ?? "MT";
  if (!allocationsSumMatchesContract(sum, trade.quantity, unit)) {
    return {
      ok: false,
      message: `Warehouse quantities must sum to ${trade.quantity} ${unit}`,
    };
  }

  return { ok: true };
}

export function assertWarehouseReadyForLock(trade: MockTraderTrade): void {
  if (!openTradeRequiresWarehouse(trade)) return;

  const validation = validateWarehouseSplitForTrade(trade);
  if (!validation.ok) throw new Error(validation.message);

  if (!trade.warehouseSplitApproved) {
    throw new Error(
      "Warehouse allocation must be approved by the head of execution before this trade can be locked",
    );
  }
}

export async function applyOpenTradeWarehouseSplit(
  tradeRef: string,
  split: WarehouseOpenAllocationLine[],
  by: string,
  approve: boolean,
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  assertOpenTrade(trade!, tradeRef);

  const validation = validateWarehouseSplitForTrade(trade!, split);
  if (!validation.ok) throw new Error(validation.message);

  const nextParams = { ...(trade!.tradeParams ?? {}) };
  nextParams[EXECUTION_WAREHOUSE_SPLIT_KEY] = serializeExecutionWarehouseSplit(split);
  trade!.tradeParams = nextParams;

  if (approve) {
    trade!.warehouseSplitApproved = true;
    trade!.warehouseSplitApprovedAt = new Date();
    trade!.warehouseSplitApprovedBy = by;
    trade!.pendingWarehouseApproval = false;
  } else {
    trade!.pendingWarehouseApproval = true;
  }

  await upsertBookedTrade(trade!);
  return trade!;
}

export async function markOpenTradeWarehousePendingApproval(
  tradeRef: string,
): Promise<MockTraderTrade> {
  const trade = await mockTradeByRefGlobal(tradeRef.trim());
  assertOpenTrade(trade!, tradeRef);
  trade!.pendingWarehouseApproval = true;
  await upsertBookedTrade(trade!);
  return trade!;
}

export async function getOpenTradesNeedingWarehouseAllocation(): Promise<OpenTradeSummary[]> {
  return (await getOpenTradesForExecution()).filter((t) => {
    if (!t.requiresWarehouse) return false;
    return !t.warehouseSplitApproved;
  });
}

export function openTradeWarehousePlan(trade: MockTraderTrade): WarehouseOpenAllocationLine[] {
  return parseExecutionWarehouseSplit(trade.tradeParams);
}

async function getLockedTradeRecord(tradeRef: string): Promise<MockTraderTrade | null> {
  const t = await mockTradeByRefGlobal(tradeRef.trim());
  if (!t || t.tradeStatus !== TradeStatus.LOCKED) return null;
  return t;
}

export async function getLockedTradeByRef(
  tradeRef: string,
): Promise<(MockTraderTrade & { expectedProfile: string }) | null> {
  const t = await getLockedTradeRecord(tradeRef);
  if (!t) return null;
  return {
    ...t,
    expectedProfile: executionProfileFromTrade(t.direction, t.buyingCategory, t.incoterms),
  };
}

export async function getLockedTradesForExecution(): Promise<OpenTradeSummary[]> {
  return (await mockAllTraderTrades())
    .filter((t) => t.tradeStatus === TradeStatus.LOCKED)
    .sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime())
    .map(toSummary);
}

export async function updateLockedTradeDirect(
  tradeRef: string,
  patch: OpenTradePatch,
  editedBy: string,
): Promise<MockTraderTrade> {
  const trade = await getLockedTradeRecord(tradeRef);
  if (!trade) throw new Error("Locked contract not found");
  const result = await applyPatchToTrade(trade, stripExecutionForbiddenPatch(patch), {
    editedBy,
    notifyTrader: false,
    editNote: patch.executionEditNote ?? null,
  });
  await syncAllLockedContracts();
  // Price edits ripple into every linked truck: expected invoices (buy),
  // receivables incl. 236G (sell) and their ledger debits recompute.
  {
    const { recomputeTradeLinkedAmounts } = await import("@/server/execution/recompute");
    await recomputeTradeLinkedAmounts(tradeRef);
  }
  await recordTradeEditApplied(tradeRef, stripExecutionForbiddenPatch(patch), {
    actorName: editedBy,
    actorSide: "EXECUTION",
    requiresApproval: false,
    note: patch.executionEditNote ?? null,
  });
  return result;
}

export async function applyLockedTradeEditFromPayload(
  tradeRef: string,
  payload: Record<string, unknown>,
  editedBy: string,
): Promise<MockTraderTrade> {
  const patch = payload as OpenTradePatch;
  return updateLockedTradeDirect(tradeRef, patch, editedBy);
}

export async function applyExecutionTradeEditFromPayload(
  tradeRef: string,
  payload: Record<string, unknown>,
  editedBy: string,
): Promise<MockTraderTrade> {
  const t = await mockTradeByRefGlobal(tradeRef.trim());
  if (!t) throw new Error("Trade not found");
  const patch = stripExecutionForbiddenPatch(normalizeOpenTradePatch(payload));
  if (t.tradeStatus === TradeStatus.LOCKED) {
    return applyLockedTradeEditFromPayload(tradeRef, patch, editedBy);
  }
  return updateOpenTradeDirect(tradeRef, patch, editedBy);
}

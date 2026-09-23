"use client";
import { isSesameCommodity, sesameFields, isPercentagePayment } from "@/lib/sesame";

import { SearchableSelect } from "@/components/ui/searchable-select";

import { OpenTradeWarehouseSection } from "@/components/execution/open-trade-warehouse-section";
import { TradeActivityPanel } from "@/components/trade/trade-activity-panel";
import {
  CornSpecificationFields,
  defaultCornSpecifications,
} from "@/components/trader/corn-specification-fields";
import { QuantityToleranceField } from "@/components/trader/quantity-tolerance-field";
import { FormField as Field, FormSection as Section } from "@/components/ui/form-section";
import { invalidateApprovalCaches, invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import {
  PRICE_CURRENCIES,
  PRICE_CURRENCY_LABELS,
  priceUnitLabel,
  type PriceCurrency,
} from "@/lib/price-units";
import {
  CORN_COMMODITY_ORIGINS,
  CORN_DEAL_STATUS_OPTIONS,
  TRADE_SCOPE_LABELS,
  executionIncotermLabel,
  incotermsForBooking,
  isCornCommodity,
  paymentTypeLabel,
  paymentTypesForBooking,
  type QualityTolerances,
} from "@/lib/trade-constants";
import type { TradeParamValues } from "@/lib/trade-parameters";
import { executionCanLockOpenTrade } from "@/lib/trade-lifecycle";
import { parseTraderWarehouseSelections } from "@/lib/warehouse-allocation";
import { trpc } from "@/lib/trpc/client";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment } from "@/lib/departments";
import { Role } from "@prisma/client";
import { ContractPreviewLink } from "@/components/execution/contract-preview-link";
import { Lock, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const inputClass = "kastros-input w-full";
const selectClass = "kastros-select w-full";

export function OpenTradeDetail({
  tradeRef,
  mode = "unreviewed",
}: {
  tradeRef: string;
  mode?: "unreviewed" | "locked";
}) {
  const isLockedMode = mode === "locked";
  const router = useRouter();
  const utils = trpc.useUtils();
  const { role, isHead } = useTeam();
  const isExecutionUser = role === Role.EXECUTION || role === Role.ADMIN;
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");
  const canEdit = isExecutionUser;

  const { data: openTrade, isLoading: openLoading } = trpc.execution.openTradeByRef.useQuery(
    { tradeRef },
    { enabled: !isLockedMode },
  );
  const { data: lockedTrade, isLoading: lockedLoading } = trpc.execution.lockedTradeByRef.useQuery(
    { tradeRef },
    { enabled: isLockedMode },
  );
  const trade = isLockedMode ? lockedTrade : openTrade;
  const isLoading = isLockedMode ? lockedLoading : openLoading;

  const { data: contractBundle } = trpc.execution.contractByRef.useQuery(
    { tradeRef },
    { enabled: isLockedMode },
  );
  const { data: companyWarehouses } = trpc.execution.companyWarehouses.useQuery(undefined, {
    enabled: isLockedMode,
  });

  const [quantityEntered, setQuantityEntered] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("MT");
  const [price, setPrice] = useState("");
  const [priceCurrency, setPriceCurrency] = useState<(typeof PRICE_CURRENCIES)[number]>("PKR");
  const [priceWeightUnit, setPriceWeightUnit] = useState("MT");
  const [priceBasis, setPriceBasis] = useState("Fixed");
  const [commissionPerUnit, setCommissionPerUnit] = useState("");
  const [deliveryStart, setDeliveryStart] = useState("");
  const [deliveryEnd, setDeliveryEnd] = useState("");
  const [incoterms, setIncoterms] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [creditDays, setCreditDays] = useState("");
  const [originName, setOriginName] = useState("");
  const [productOrigin, setProductOrigin] = useState("");
  const [grade, setGrade] = useState("");
  const [notes, setNotes] = useState("");
  const [cornSpecs, setCornSpecs] = useState<QualityTolerances>(defaultCornSpecifications());
  const [tradeParams, setTradeParams] = useState<TradeParamValues>({});
  const [warehouseSelections, setWarehouseSelections] = useState<string[]>([]);
  const [editNote, setEditNote] = useState("");
  const [requestComment, setRequestComment] = useState("");
  const [counterpartyName, setCounterpartyName] = useState("");
  const [counterpartyNtn, setCounterpartyNtn] = useState("");
  const [counterpartyContactPerson, setCounterpartyContactPerson] = useState("");
  const [counterpartyContactPhone, setCounterpartyContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isSesame = isSesameCommodity(trade?.commodity.code, trade?.commodity.name);
  const isCorn = isCornCommodity(trade?.commodity.code);
  const tradeScope = trade?.tradeScope ?? "LOCAL";
  const requiresWarehouse =
    trade?.expectedProfile === "PURCHASE_DELIVERED" || trade?.expectedProfile === "SALE_EX_WAREHOUSE";

  const bookingIncoterms = useMemo(
    () => (trade ? incotermsForBooking(trade.direction, tradeScope, trade.commodity.code) : []),
    [trade, tradeScope],
  );

  const visiblePaymentTypes = useMemo(
    () => paymentTypesForBooking(isCorn, tradeScope),
    [isCorn, tradeScope],
  );

  useEffect(() => {
    if (!trade) return;
    setQuantityEntered(String(trade.quantityEntered ?? trade.quantity));
    setQuantityUnit(trade.quantityEnteredUnit ?? trade.quantityUnit ?? "MT");
    setPrice(String(trade.price));
    setPriceCurrency((trade.priceCurrency ?? "PKR") as (typeof PRICE_CURRENCIES)[number]);
    setPriceWeightUnit(trade.priceWeightUnit ?? trade.quantityUnit ?? "MT");
    setPriceBasis(trade.priceBasis ?? "Fixed");
    setCommissionPerUnit(
      trade.commissionPerUnit != null
        ? String(trade.commissionPerUnit)
        : trade.commissionAmount != null
          ? String(trade.commissionAmount)
          : "",
    );
    setDeliveryStart(trade.deliveryStart.toISOString().slice(0, 10));
    setDeliveryEnd(trade.deliveryEnd.toISOString().slice(0, 10));
    setIncoterms(trade.incoterms);
    setPaymentType(trade.paymentType);
    const cd = trade.tradeParams?.creditDays;
    setCreditDays(cd != null ? String(cd) : "");
    setOriginName(trade.originName ?? "");
    setProductOrigin(trade.productOrigin ?? "");
    setGrade(trade.grade ?? "");
    setNotes(trade.notes ?? "");
    setCornSpecs(trade.qualityTolerancesDetail ?? defaultCornSpecifications());
    const params: TradeParamValues = {};
    for (const [k, v] of Object.entries(trade.tradeParams ?? {})) {
      if (
        v != null &&
        k !== "warehouseSelections" &&
        k !== "warehouse" &&
        k !== "executionWarehouseSplit" &&
        k !== "creditDays"
      ) {
        params[k] = v;
      }
    }
    setTradeParams(params);
    setWarehouseSelections(parseTraderWarehouseSelections(trade.tradeParams));
    setEditNote(trade.executionEditNote ?? "");
    setCounterpartyName(trade.counterparty.name);
    setCounterpartyNtn(trade.counterparty.ntn ?? "");
    setCounterpartyContactPerson(trade.counterparty.contactPerson ?? "");
    setCounterpartyContactPhone(trade.counterparty.contactPhone ?? "");
    setSaved(false);
  }, [trade]);

  const canLock =
    isExecutionUser &&
    executionCanLockOpenTrade({
      pendingTraderReview: trade?.pendingTraderReview,
      pendingTraderPrice: trade?.pendingTraderPrice,
      requiresWarehouse,
      warehouseSplitApproved: trade?.warehouseSplitApproved,
    });

  const ro = !canEdit;

  function buildPatch() {
    if (deliveryEnd < deliveryStart) throw new Error("Delivery end must be after start");

    const cleanedParams: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(tradeParams)) {
      if (v != null && String(v).trim() !== "") cleanedParams[k] = typeof v === "number" ? v : String(v).trim();
    }
    if (paymentType === "CREDIT" && creditDays) {
      cleanedParams.creditDays = parseInt(creditDays, 10);
    }

    return {
      deliveryStart: new Date(deliveryStart),
      deliveryEnd: new Date(deliveryEnd),
      incoterms,
      paymentType: paymentType as "DP" | "LC" | "CAD" | "ADVANCE_100" | "CREDIT" | "CREDIT_30" | "AFTER_DELIVERY_100",
      creditDays: paymentType === "CREDIT" ? parseInt(creditDays, 10) || undefined : undefined,
      originName: isCorn ? "" : originName,
      productOrigin,
      grade,
      notes: notes.trim() || null,
      qualityTolerancesDetail: isCorn ? cornSpecs : undefined,
      tradeParams: cleanedParams,
      warehouseSelections,
      executionEditNote: editNote.trim() || null,
      counterparty: {
        name: counterpartyName.trim(),
        ntn: counterpartyNtn.trim() || null,
        contactPerson: counterpartyContactPerson.trim() || null,
        contactPhone: counterpartyContactPhone.trim() || null,
      },
    };
  }

  const updateOpenDirect = trpc.execution.updateOpenTrade.useMutation({
    onSuccess: () => {
      setSaved(true);
      setError(null);
      invalidateTradeFlowCaches(utils, tradeRef);
    },
    onError: (e) => setError(e.message),
  });

  const updateLockedDirect = trpc.execution.updateLockedTrade.useMutation({
    onSuccess: () => {
      setSaved(true);
      setError(null);
      invalidateTradeFlowCaches(utils, tradeRef);
    },
    onError: (e) => setError(e.message),
  });

  const updateDirect = isLockedMode ? updateLockedDirect : updateOpenDirect;

  const lockTrade = trpc.execution.lockOpenTrade.useMutation({
    onSuccess: () => {
      invalidateTradeFlowCaches(utils, tradeRef);
      router.push("/execution/contracts");
    },
    onError: (e) => setError(e.message),
  });

  const submitRequest = trpc.team.submitChangeRequest.useMutation({
    onSuccess: () => {
      setRequestComment("");
      setSaved(true);
      setError(null);
      // The request has to show up in the head's queue (and the sender's own
      // "My requests") straight away, or it reads as though nothing was sent.
      invalidateApprovalCaches(utils);
    },
    onError: (e) => setError(e.message),
  });

  function saveDirect() {
    setError(null);
    try {
      const patch = buildPatch();
      updateDirect.mutate({ tradeRef, patch });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid form");
    }
  }

  function requestEdit() {
    setError(null);
    if (!requestComment.trim()) {
      setError("Add a comment for the head of execution");
      return;
    }
    try {
      const patch = buildPatch();
      const { executionEditNote, ...payload } = patch;
      submitRequest.mutate({
        department: "EXECUTION",
        entityType: "TRADE",
        entityRef: tradeRef,
        entityLabel: `${tradeRef} ${isLockedMode ? "locked contract" : "unreviewed trade"} edit`,
        action: "EDIT",
        comment: requestComment.trim(),
        payload: executionEditNote != null ? patch : payload,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid form");
    }
  }

  if (isLoading || !trade) {
    return (
      <div className="animate-pulse text-subtle">
        Loading {isLockedMode ? "locked contract" : "unreviewed trade"}…
      </div>
    );
  }

  const quotedUnit = priceUnitLabel({ currency: priceCurrency, weightUnit: priceWeightUnit });
  const backHref = isLockedMode ? "/execution/contracts" : "/execution/open-trades";
  const backLabel = isLockedMode ? "Reviewed trades" : "Unreviewed trades";

  return (
    <div className="kastros-desk-page mx-auto w-full max-w-4xl">
      <div className="kastros-desk-toolbar">
        <Link href={backHref} className="text-xs text-subtle hover:text-accent-secondary">
          ← {backLabel}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold text-foreground">{trade.tradeRef}</h1>
            <p className="text-sm text-subtle">
              {trade.traderName} · {trade.counterparty.code} — {trade.counterparty.name} ·{" "}
              {trade.commodity.code} · {TRADE_SCOPE_LABELS[tradeScope]}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isLockedMode && <ContractPreviewLink tradeRef={trade.tradeRef} variant="toolbar" />}
          {isLockedMode ? (
            <span className="rounded-md bg-info/20 px-3 py-1 text-sm font-medium text-info">
              Locked — editable with head approval
            </span>
          ) : trade.pendingTraderPrice ? (
            <span className="rounded-md bg-warning/20 px-3 py-1 text-sm font-medium text-warning">
              Awaiting trader price
            </span>
          ) : trade.pendingTraderReview ? (
            <span className="rounded-md bg-warning/20 px-3 py-1 text-sm font-medium text-warning">
              Awaiting trader review
            </span>
          ) : (
            <span className="rounded-md bg-accent-secondary/20 px-3 py-1 text-sm font-medium text-accent-secondary">
              Unreviewed — review booking details below
            </span>
          )}
          </div>
        </div>
      </div>

      <div className="kastros-desk-scroll space-y-5">
      {!isLockedMode && trade.pendingTraderPrice && (
        <div className="exec-alert-danger text-sm">
          Trader has not entered the contract price yet. This trade cannot be locked until the trader saves the
          price from My Trades.
        </div>
      )}

      <TradeActivityPanel tradeRef={tradeRef} audience="execution" />

      {!isLockedMode && trade.pendingTraderReview && (
        <div className="exec-alert-danger text-sm">
          Execution edits were sent to the trader on{" "}
          {trade.executionLastEditedAt
            ? new Date(trade.executionLastEditedAt).toLocaleString()
            : "—"}
          {trade.executionLastEditedBy ? ` by ${trade.executionLastEditedBy}` : ""}. The trader must lock
          this trade after reviewing.
        </div>
      )}

      <div className="space-y-5 rounded-lg border border-kastros-border bg-kastros-card p-5">
        {/* ── 1. Deal (matches Book a Trade) ── */}
        <Section title="Deal" description="Commodity, counterparty, and market — as booked by the trader">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Commodity">
              <input
                readOnly
                value={`${trade.commodity.code} — ${trade.commodity.name}`}
                className={`${inputClass} opacity-80`}
              />
            </Field>

            <Field label="Counterparty">
              <input
                readOnly
                value={`${trade.counterparty.code} — ${trade.counterparty.name}`}
                className={`${inputClass} font-mono opacity-80`}
              />
            </Field>

            {/* These edit the counterparty record itself, not this trade — one
                record shared by every trade booked against it, so a correction
                here lands on all of them. */}
            <Field label="Trading name">
              <input
                readOnly={ro}
                value={counterpartyName}
                onChange={(e) => setCounterpartyName(e.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-subtle">
                Saving updates the counterparty on every trade of theirs.
              </p>
            </Field>

            <Field label="NTN no.">
              <input
                readOnly={ro}
                value={counterpartyNtn}
                onChange={(e) => setCounterpartyNtn(e.target.value)}
                placeholder="As entered by trader"
                className={`${inputClass} font-mono`}
              />
            </Field>

            <Field label="Trade date">
              <input
                readOnly
                type="date"
                value={trade.tradeDate.toISOString().slice(0, 10)}
                className={`${selectClass} opacity-80`}
              />
            </Field>

            <Field label="Direction">
              <input readOnly value={trade.direction} className={`${inputClass} opacity-80`} />
            </Field>

            <Field label="Market">
              <input
                readOnly
                value={TRADE_SCOPE_LABELS[tradeScope]}
                className={`${inputClass} opacity-80`}
              />
            </Field>

            {isCorn ? (
              <>
                <Field label="Commodity origin (optional)">
                  <SearchableSelect
                    disabled={ro}
                    value={productOrigin}
                    onChange={(e) => setProductOrigin(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">—</option>
                    {CORN_COMMODITY_ORIGINS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </SearchableSelect>
                </Field>
                {tradeScope === "LOCAL" && (
                  <Field label="Deal status">
                    <SearchableSelect
                      disabled={ro}
                      value={String(tradeParams.dealStatus ?? "")}
                      onChange={(e) =>
                        setTradeParams((p) => ({
                          ...p,
                          dealStatus: e.target.value || undefined,
                        }))
                      }
                      className={selectClass}
                    >
                      <option value="">—</option>
                      {CORN_DEAL_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </SearchableSelect>
                  </Field>
                )}
                {/* Filled from the counterparty record, editable here — a
                    correction lands on the counterparty, so every trade of
                    theirs shows it. */}
                <Field label="Contact person">
                  <input
                    readOnly={ro}
                    value={counterpartyContactPerson}
                    onChange={(e) => setCounterpartyContactPerson(e.target.value)}
                    placeholder="From counterparty record"
                    className={selectClass}
                  />
                </Field>
                <Field label="Contact number">
                  <input
                    readOnly={ro}
                    value={counterpartyContactPhone}
                    onChange={(e) => setCounterpartyContactPhone(e.target.value)}
                    placeholder="From counterparty record"
                    className={`${selectClass} font-mono`}
                  />
                </Field>
              </>
            ) : (
              <Field label="Commodity origin">
                <input
                  readOnly={ro}
                  value={productOrigin}
                  onChange={(e) => setProductOrigin(e.target.value)}
                  className={selectClass}
                />
              </Field>
            )}
          </div>
        </Section>

        {/* ── 2. Quantity & pricing ── */}
        <Section
          title="Quantity & pricing"
          description={`Price and quantity are set by the trader. Execution can review but not edit these fields (${quotedUnit}).`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Quantity (${quantityUnit})`}>
              <input
                readOnly
                type="number"
                step="0.01"
                value={quantityEntered}
                className={`${inputClass} data-grid opacity-80`}
              />
            </Field>
            <Field label="Unit">
              <input readOnly value={quantityUnit} className={`${inputClass} opacity-80`} />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Quoted currency">
              <input readOnly value={PRICE_CURRENCY_LABELS[priceCurrency as PriceCurrency] ?? priceCurrency} className={`${selectClass} opacity-80`} />
            </Field>
            <Field label="Price per unit">
              <input readOnly value={priceWeightUnit} className={`${selectClass} opacity-80`} />
            </Field>
            <Field label="Price basis">
              <input readOnly value={priceBasis} className={`${selectClass} opacity-80`} />
            </Field>
          </div>

          <div className="mt-4">
            <QuantityToleranceField
              values={tradeParams}
              quantityUnit={quantityUnit}
              readOnly
              onChange={() => {}}
            />
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label={`Price (${quotedUnit}) (without commission)`}>
              <input
                readOnly
                type="number"
                step="0.0001"
                value={price}
                className={`${inputClass} data-grid opacity-80`}
              />
            </Field>
            <Field label={`Broker commission (${quotedUnit})`}>
              <input
                readOnly
                type="number"
                step="0.0001"
                value={commissionPerUnit}
                className={`${inputClass} data-grid opacity-80`}
              />
            </Field>
          </div>
        </Section>

        {/* ── 3. Delivery ── */}
        <Section title="Delivery" description="Incoterms, delivery window, and warehouse selections">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Incoterms">
              <SearchableSelect
                disabled={ro}
                value={incoterms}
                onChange={(e) => setIncoterms(e.target.value)}
                className={selectClass}
              >
                {bookingIncoterms.map((i) => (
                  <option key={i} value={i}>
                    {executionIncotermLabel(i)}
                  </option>
                ))}
              </SearchableSelect>
              {tradeScope === "LOCAL" && isCorn && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Local corn: EXW — Ex Works or Delivered.
                </p>
              )}
            </Field>
            <Field label="Delivery start">
              <input
                readOnly={ro}
                type="date"
                value={deliveryStart}
                onChange={(e) => setDeliveryStart(e.target.value)}
                className={selectClass}
              />
            </Field>
            <Field label="Delivery end">
              <input
                readOnly={ro}
                type="date"
                value={deliveryEnd}
                onChange={(e) => setDeliveryEnd(e.target.value)}
                className={selectClass}
              />
            </Field>
            {!isCorn && (
              <Field label="Origin / load point (optional)">
                <input
                  readOnly={ro}
                  value={originName}
                  onChange={(e) => setOriginName(e.target.value)}
                  className={selectClass}
                />
              </Field>
            )}
            {!isCorn && (
              <Field label="Grade">
                <input readOnly={ro} value={grade} onChange={(e) => setGrade(e.target.value)} className={inputClass} />
              </Field>
            )}
            {warehouseSelections.length > 0 && (
              <Field label="Warehouses selected at booking">
                <input
                  readOnly
                  value={warehouseSelections.join(", ")}
                  className={`${inputClass} opacity-80`}
                />
              </Field>
            )}
          </div>
        </Section>

        {/* ── 4. Payment ── */}
        <Section title="Payment" description="Settlement terms for this trade">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Payment type</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {visiblePaymentTypes.map((pt) =>
                pt === "CREDIT" ? (
                  <label
                    key={pt}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-kastros-border px-3 py-2 text-xs hover:bg-foreground/[0.02] has-[:checked]:border-success has-[:checked]:bg-success/5"
                  >
                    <input
                      type="radio"
                      value={pt}
                      checked={paymentType === pt}
                      disabled={ro}
                      onChange={() => setPaymentType(pt)}
                      className="accent-brand"
                    />
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={creditDays}
                        disabled={ro}
                        onChange={(e) => setCreditDays(e.target.value)}
                        onFocus={() => setPaymentType("CREDIT")}
                        className="w-11 rounded border border-kastros-border/80 bg-kastros-bg px-1 py-0.5 text-center text-xs text-foreground data-grid focus:border-success/50 focus:outline-none"
                      />
                      <span>Day Credit</span>
                    </span>
                  </label>
                ) : (
                  <label
                    key={pt}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-kastros-border px-3 py-2 text-xs hover:bg-foreground/[0.02] has-[:checked]:border-success has-[:checked]:bg-success/5"
                  >
                    <input
                      type="radio"
                      value={pt}
                      checked={paymentType === pt}
                      disabled={ro}
                      onChange={() => setPaymentType(pt)}
                      className="accent-brand"
                    />
                    <span className="text-muted-foreground">{paymentTypeLabel(pt, undefined, isSesame && isPercentagePayment(pt) ? Number(tradeParams.paymentPercentage) || 100 : undefined)}</span>
                  </label>
                ),
              )}
            </div>
          </div>
        </Section>

        {isSesame && <Section title="Sesame specifications and route"><div className="grid gap-3 sm:grid-cols-2">{sesameFields(tradeParams).map(def => <Field key={def.key} label={def.label}><input readOnly value={`${tradeParams[def.key] ?? "—"}${def.type === "percent" ? "%" : ""}`} className={`${inputClass} opacity-80`} /></Field>)}</div></Section>}

        {/* ── 5. Specification (corn) ── */}
        {isCorn && (
          <Section
            title="Specification"
            description="Quality tolerances for this corn trade — all values in percent"
          >
            <CornSpecificationFields
              values={cornSpecs}
              onChange={setCornSpecs}
              readOnly={ro}
            />
          </Section>
        )}

        <Field label="Internal notes (optional)">
          <textarea
            readOnly={ro}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={selectClass}
          />
        </Field>

        {isExecutionHead && (
          <Field label="Note to trader (optional)">
            <input
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Explain changes sent for trader review…"
              className={inputClass}
            />
          </Field>
        )}
      </div>

      <OpenTradeWarehouseSection
        isLockedMode={isLockedMode}
        requiresWarehouse={requiresWarehouse}
        tradeRef={tradeRef}
        trade={trade}
        contract={contractBundle?.contract}
        companyWarehouses={companyWarehouses}
        isExecutionHead={isExecutionHead}
        isExecutionUser={isExecutionUser}
      />

      </div>

      {/* Outcome sits WITH the button in the fixed toolbar, never inside the
          scrolling form above it — a message rendered off-screen is the same
          as no message, and the button reads as broken. */}
      <div className="kastros-desk-toolbar flex flex-wrap items-center gap-3 border-t border-kastros-border pt-4">
        {isExecutionHead ? (
          <button
            type="button"
            disabled={updateDirect.isPending}
            onClick={saveDirect}
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {updateDirect.isPending
              ? "Saving…"
              : isLockedMode
                ? "Save changes"
                : "Save & notify trader"}
          </button>
        ) : isExecutionUser ? (
          <>
            <input
              placeholder="Comment for head of execution…"
              value={requestComment}
              onChange={(e) => {
                setRequestComment(e.target.value);
                // Typing a fresh comment means a fresh request — drop the
                // confirmation from the previous one.
                if (saved) setSaved(false);
              }}
              className="kastros-input min-w-[200px] flex-1"
            />
            <button
              type="button"
              // A comment is what the head reads to decide — without one the
              // button would only ever no-op, so it says so instead.
              disabled={submitRequest.isPending || !requestComment.trim()}
              title={
                requestComment.trim()
                  ? "Send your edits to the head of execution for approval"
                  : "Add a comment for the head of execution first"
              }
              onClick={requestEdit}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {submitRequest.isPending ? "Submitting…" : "Request edit approval"}
            </button>
          </>
        ) : null}

        {error && <p className="w-full text-sm text-destructive">{error}</p>}
        {saved && !error && (
          <p className="flex w-full flex-wrap items-center gap-2 text-sm text-success">
            {isExecutionHead ? (
              isLockedMode ? (
                "Changes saved to locked contract."
              ) : (
                "Changes saved — trader will be notified to review."
              )
            ) : (
              <>
                Change request sent to the head of execution.
                <Link href="/execution/approvals" className="underline hover:text-foreground">
                  View my requests →
                </Link>
              </>
            )}
          </p>
        )}

        {!isLockedMode && canLock && (
          <button
            type="button"
            disabled={lockTrade.isPending}
            onClick={() => {
              if (!confirm(`Lock ${tradeRef} and move to Reviewed Trades?`)) return;
              lockTrade.mutate({ tradeRef });
            }}
            className="inline-flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-4 py-2 text-sm font-semibold text-success disabled:opacity-50"
          >
            <Lock className="h-4 w-4" />
            {lockTrade.isPending ? "Locking…" : "Lock trade"}
          </button>
        )}

        {!isLockedMode && requiresWarehouse && !trade.warehouseSplitApproved && isExecutionUser && (
          <p className="text-xs text-warning">
            {trade.pendingWarehouseApproval
              ? "Warehouse allocation is awaiting head approval — Lock will appear once the head approves."
              : isExecutionHead
                ? "Allocate warehouse quantities below and use Save & approve allocation before locking."
                : "Allocate warehouse quantities below and submit for head approval before locking."}
          </p>
        )}

        {!isLockedMode && trade.pendingTraderPrice && isExecutionUser && (
          <p className="text-xs text-warning">
            Waiting for trader to enter price from My Trades.
          </p>
        )}

        <Link href="/execution/contracts" className="text-sm text-subtle hover:text-foreground">
          {isLockedMode ? "Back to reviewed trades →" : "View reviewed trades →"}
        </Link>
      </div>
    </div>
  );
}

"use client";

import {
  CornSpecificationFields,
  defaultCornSpecifications,
} from "@/components/trader/corn-specification-fields";
import { QuantityToleranceField } from "@/components/trader/quantity-tolerance-field";
import { FormField as Field, FormSection as Section } from "@/components/ui/form-section";
import { NumericInput } from "@/components/ui/numeric-input";
import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { numericStringFromValue, parseNumericString } from "@/lib/numeric-input";
import {
  PRICE_CURRENCIES,
  PRICE_CURRENCY_LABELS,
  priceUnitLabel,
  quotedCurrencyLabel,
  type PriceCurrency,
} from "@/lib/price-units";
import {
  executionIncotermLabel,
  incotermsForBooking,
  isCornCommodity,
  paymentTypeLabel,
  paymentTypesForBooking,
  priceBasisOptionsForCommodity,
  priceBasisRequiresQuote,
  type QualityTolerances,
} from "@/lib/trade-constants";
import type { TradeParamValues } from "@/lib/trade-parameters";
import { trpc } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/routers/_app";
import type { inferRouterOutputs } from "@trpc/server";
import { isTraderDraft } from "@/lib/trade-lifecycle";
import { AlertTriangle, Save, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Trade = NonNullable<inferRouterOutputs<AppRouter>["trader"]["tradeByRef"]>;

const inputClass = "kastros-input w-full";
const selectClass = "kastros-select w-full";

export const TRADE_EDIT_SECTION_ID = "trade-edit";

export function TradeChangeForm({
  trade,
  mode: modeProp,
  embedded = false,
  onDone,
}: {
  trade: Trade;
  /** direct = draft save; ceo = approval required. Defaults from trade state. */
  mode?: "direct" | "ceo";
  embedded?: boolean;
  onDone?: () => void;
}) {
  const mode = modeProp ?? (isTraderDraft(trade) ? "direct" : "ceo");
  const utils = trpc.useUtils();
  const tradeRef = trade.tradeRef;
  const isCorn = isCornCommodity(trade.commodity.code);
  const tradeScope = trade.tradeScope ?? "LOCAL";

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
  const [comment, setComment] = useState("");
  const [deleteComment, setDeleteComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<"EDIT" | "DELETE" | null>(null);

  const bookingIncoterms = useMemo(
    () => incotermsForBooking(trade.direction, tradeScope, trade.commodity.code),
    [trade.direction, tradeScope, trade.commodity.code],
  );
  const priceBasisOptions = useMemo(
    () => priceBasisOptionsForCommodity(trade.commodity.code),
    [trade.commodity.code],
  );
  const visiblePaymentTypes = useMemo(
    () => paymentTypesForBooking(isCorn, tradeScope),
    [isCorn, tradeScope],
  );
  const quotedUnit = priceUnitLabel({ currency: priceCurrency, weightUnit: priceWeightUnit });

  useEffect(() => {
    setQuantityEntered(numericStringFromValue(trade.quantityEntered ?? trade.quantity));
    setQuantityUnit(trade.quantityEnteredUnit ?? trade.quantityUnit ?? "MT");
    setPrice(trade.price > 0 ? numericStringFromValue(trade.price) : "");
    setPriceCurrency((trade.priceCurrency ?? "PKR") as (typeof PRICE_CURRENCIES)[number]);
    setPriceWeightUnit(trade.priceWeightUnit ?? trade.quantityUnit ?? "MT");
    setPriceBasis(trade.priceBasis ?? "Fixed");
    setCommissionPerUnit(
      trade.commissionPerUnit != null
        ? numericStringFromValue(trade.commissionPerUnit)
        : trade.commissionAmount != null
          ? numericStringFromValue(trade.commissionAmount)
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
    setSubmitted(null);
    setError(null);
  }, [trade]);

  const submitRequest = trpc.team.submitChangeRequest.useMutation({
    onSuccess: (_data, variables) => {
      setSubmitted(variables.action === "DELETE" ? "DELETE" : "EDIT");
      setComment("");
      setDeleteComment("");
      setError(null);
      invalidateTradeFlowCaches(utils, tradeRef);
      void utils.trader.tradeTimeline.invalidate({ tradeRef });
      onDone?.();
    },
    onError: (e) => setError(e.message),
  });

  const saveDraft = trpc.trader.updateDraftTrade.useMutation({
    onSuccess: () => {
      setSubmitted("EDIT");
      setError(null);
      invalidateTradeFlowCaches(utils, tradeRef);
      void utils.trader.tradeTimeline.invalidate({ tradeRef });
      onDone?.();
    },
    onError: (e) => setError(e.message),
  });

  function buildPayload() {
    const qty = parseNumericString(quantityEntered);
    const px = parseNumericString(price);
    if (qty == null || qty <= 0) throw new Error("Enter a valid quantity");
    if (priceBasisRequiresQuote(priceBasis)) {
      if (px == null || px <= 0) throw new Error("Enter a valid price for this price basis");
    }
    if (deliveryEnd < deliveryStart) throw new Error("Delivery end must be after start");

    const cleanedParams: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(tradeParams)) {
      if (v != null && String(v).trim() !== "") {
        cleanedParams[k] = typeof v === "number" ? v : String(v).trim();
      }
    }
    if (paymentType === "CREDIT" && creditDays) {
      cleanedParams.creditDays = parseInt(creditDays, 10);
    }

    const commission =
      commissionPerUnit.trim() !== "" ? parseNumericString(commissionPerUnit) : null;

    return {
      quantityEntered: qty,
      quantityEnteredUnit: quantityUnit,
      ...(px != null && px > 0 ? { price: px, priceCurrency, priceWeightUnit } : {}),
      priceBasis,
      commissionAmount:
        commission != null && commission > 0 ? commission : null,
      deliveryStart: new Date(deliveryStart),
      deliveryEnd: new Date(deliveryEnd),
      incoterms,
      paymentType,
      creditDays: paymentType === "CREDIT" ? parseInt(creditDays, 10) || undefined : undefined,
      originName: isCorn ? "" : originName,
      productOrigin,
      grade,
      notes: notes.trim() || null,
      qualityTolerancesDetail: isCorn ? cornSpecs : undefined,
      tradeParams: cleanedParams,
    };
  }

  function submitEdit() {
    setError(null);
    try {
      const payload = buildPayload();
      if (mode === "direct") {
        saveDraft.mutate({ tradeRef, patch: payload });
        return;
      }
      if (!comment.trim()) {
        setError("Add a comment for the CEO explaining what changed and why");
        return;
      }
      submitRequest.mutate({
        department: "TRADING",
        entityType: "TRADE",
        entityRef: tradeRef,
        entityLabel: `${tradeRef} · ${trade.commodity.code} · ${trade.counterparty.name}`,
        action: "EDIT",
        comment: comment.trim(),
        payload,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid form");
    }
  }

  function submitDelete() {
    setError(null);
    if (!deleteComment.trim()) {
      setError("Add a comment for the CEO explaining why this trade should be deleted");
      return;
    }
    submitRequest.mutate({
      department: "TRADING",
      entityType: "TRADE",
      entityRef: tradeRef,
      entityLabel: `${tradeRef} · ${trade.commodity.code} · ${trade.counterparty.name}`,
      action: "DELETE",
      comment: deleteComment.trim(),
    });
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
        {submitted === "DELETE"
          ? "Delete request sent to the CEO for approval."
          : mode === "direct"
            ? "Changes saved to your draft."
            : "Change request sent to the CEO for approval."}{" "}
        {mode === "ceo" && (
          <>
            Track it under{" "}
            <Link href="/trader/approvals" className="font-medium underline">
              Approvals
            </Link>
            .
          </>
        )}
      </div>
    );
  }

  const shellClass = embedded
    ? "space-y-5"
    : `scroll-mt-6 space-y-5 rounded-lg border border-kastros-border bg-kastros-card p-5`;

  return (
    <div id={embedded ? undefined : TRADE_EDIT_SECTION_ID} className={shellClass}>
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {mode === "direct" ? "Edit draft trade" : "Edit price, quantity & terms"}
        </h2>
        <p className="mt-1 text-xs text-subtle">
          {mode === "direct"
            ? "This trade has not been submitted to execution yet — save changes directly."
            : "This trade is with execution or locked — submit changes for CEO approval before they apply."}
        </p>
      </div>

      <Section title="Quantity & pricing" description={`Price and commission per ${quotedUnit}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Quantity (${quantityUnit})`}>
            <NumericInput
              value={parseNumericString(quantityEntered)}
              onChange={(n) =>
                setQuantityEntered(n != null ? numericStringFromValue(n) : "")
              }
              className={`${inputClass} data-grid`}
            />
          </Field>
          <Field label="Unit">
            <input
              value={quantityUnit}
              onChange={(e) => setQuantityUnit(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Quoted currency">
            <select
              value={priceCurrency}
              onChange={(e) => setPriceCurrency(e.target.value as (typeof PRICE_CURRENCIES)[number])}
              className={selectClass}
            >
              {PRICE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {PRICE_CURRENCY_LABELS[c as PriceCurrency] ?? quotedCurrencyLabel(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price per unit">
            <input
              value={priceWeightUnit}
              onChange={(e) => setPriceWeightUnit(e.target.value)}
              className={selectClass}
            />
          </Field>
          <Field label="Price basis">
            <select value={priceBasis} onChange={(e) => setPriceBasis(e.target.value)} className={selectClass}>
              {priceBasisOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4">
          <QuantityToleranceField
            values={tradeParams}
            quantityUnit={quantityUnit}
            onChange={(key, value) => setTradeParams((p) => ({ ...p, [key]: value }))}
          />
        </div>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label={`Price (${quotedUnit})`}>
            <NumericInput
              value={parseNumericString(price)}
              onChange={(n) => setPrice(n != null ? numericStringFromValue(n) : "")}
              className={`${inputClass} data-grid`}
            />
          </Field>
          <Field label={`Broker commission (${quotedUnit})`}>
            <NumericInput
              value={parseNumericString(commissionPerUnit)}
              onChange={(n) =>
                setCommissionPerUnit(n != null ? numericStringFromValue(n) : "")
              }
              className={`${inputClass} data-grid`}
            />
          </Field>
        </div>
      </Section>

      <Section title="Delivery & terms">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Incoterms">
            <select value={incoterms} onChange={(e) => setIncoterms(e.target.value)} className={selectClass}>
              {bookingIncoterms.map((i) => (
                <option key={i} value={i}>
                  {executionIncotermLabel(i)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Delivery start">
            <input
              type="date"
              value={deliveryStart}
              onChange={(e) => setDeliveryStart(e.target.value)}
              className={selectClass}
            />
          </Field>
          <Field label="Delivery end">
            <input
              type="date"
              value={deliveryEnd}
              onChange={(e) => setDeliveryEnd(e.target.value)}
              className={selectClass}
            />
          </Field>
          {!isCorn && (
            <>
              <Field label="Origin / load point">
                <input value={originName} onChange={(e) => setOriginName(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Grade">
                <input value={grade} onChange={(e) => setGrade(e.target.value)} className={inputClass} />
              </Field>
            </>
          )}
          {!isCorn && (
            <Field label="Product origin">
              <input value={productOrigin} onChange={(e) => setProductOrigin(e.target.value)} className={inputClass} />
            </Field>
          )}
        </div>
      </Section>

      <Section title="Payment">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment type">
            <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} className={selectClass}>
              {visiblePaymentTypes.map((pt) => (
                <option key={pt} value={pt}>
                  {paymentTypeLabel(pt)}
                </option>
              ))}
            </select>
          </Field>
          {paymentType === "CREDIT" && (
            <Field label="Credit days">
              <input
                type="number"
                value={creditDays}
                onChange={(e) => setCreditDays(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
        </div>
      </Section>

      {isCorn && (
        <Section title="Corn specifications">
          <CornSpecificationFields values={cornSpecs} onChange={setCornSpecs} />
        </Section>
      )}

      <Field label="Notes">
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
      </Field>

      {mode === "ceo" && (
        <Field label="Comment for CEO">
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Explain what you changed and why the CEO should approve…"
            className={inputClass}
          />
        </Field>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={submitRequest.isPending || saveDraft.isPending}
        onClick={submitEdit}
        className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
      >
        {mode === "direct" ? <Save className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        {saveDraft.isPending || submitRequest.isPending
          ? "Saving…"
          : mode === "direct"
            ? "Save changes"
            : "Submit for CEO approval"}
      </button>

      {mode === "ceo" && (
        <div className="border-t border-kastros-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">Delete trade</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            To remove this trade entirely, request deletion — the CEO must approve.
          </p>
          <textarea
            rows={2}
            value={deleteComment}
            onChange={(e) => setDeleteComment(e.target.value)}
            placeholder="Reason for deletion…"
            className={`${inputClass} mt-2`}
          />
          <button
            type="button"
            disabled={submitRequest.isPending}
            onClick={submitDelete}
            className="mt-2 inline-flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Request deletion
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { TRADE_SCOPE_LABELS, executionIncotermLabel, paymentTypeLabel } from "@/lib/trade-constants";
import { parseTraderWarehouseSelections } from "@/lib/warehouse-allocation";
import {
  currencyToBaseFactor,
  defaultKgPerUnit,
  priceUnitLabel,
  quotedCurrencyLabel,
} from "@/lib/price-units";
import { resolveAllTradeParameters, UNIVERSAL_TRADE_FIELDS } from "@/lib/trade-parameters";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import { executionWorkspacePath } from "@/lib/execution-routes";
import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { PenLine, X } from "lucide-react";
import { TradeChangeForm, TRADE_EDIT_SECTION_ID } from "@/components/trader/trade-change-form";
import { TradeActivityPanel } from "@/components/trade/trade-activity-panel";
import { isTraderDraft, traderCanEditTrade } from "@/lib/trade-lifecycle";

export default function TradeDetailPage() {
  const params = useParams();
  const tradeRef = decodeURIComponent(params.ref as string);
  const utils = trpc.useUtils();
  const { data: trade, isLoading, isFetching, isError, refetch } = trpc.trader.tradeByRef.useQuery(
    { tradeRef },
    { retry: 2, retryDelay: 400 },
  );
  const submitToExecution = trpc.trader.submitTradeToExecution.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils, tradeRef),
  });
  const completePrice = trpc.trader.completeTradePrice.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils, tradeRef),
  });
  const approveEdits = trpc.trader.approveExecutionEdits.useMutation({
    onSuccess: () => {
      invalidateTradeFlowCaches(utils, tradeRef);
      void utils.trader.executionEditApprovals.invalidate();
      void utils.trader.executionEditApprovalsCount.invalidate();
    },
  });
  const requestSettlement = trpc.trader.requestSettlement.useMutation({
    onSuccess: () => {
      void utils.trader.myTrades.invalidate();
      void utils.trader.tradeByRef.invalidate({ tradeRef });
      setSettling(false);
      setSettlementReason("");
    },
  });
  const cancelSettlement = trpc.trader.cancelSettlement.useMutation({
    onSuccess: () => {
      void utils.trader.myTrades.invalidate();
      void utils.trader.tradeByRef.invalidate({ tradeRef });
    },
  });
  const policy = trpc.policy.get.useQuery();
  const refData = trpc.trader.referenceData.useQuery();
  const [priceInput, setPriceInput] = useState<number>(0);
  const [commissionInput, setCommissionInput] = useState<number>(0);
  const [editing, setEditing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settlementReason, setSettlementReason] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !trade) return;
    if (window.location.hash === `#${TRADE_EDIT_SECTION_ID}`) {
      setEditing(true);
    }
  }, [trade]);

  if (isLoading || (isFetching && !trade)) {
    return <div className="animate-pulse text-subtle">Loading trade…</div>;
  }

  if (!trade) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground">
          {isError
            ? "Could not load this trade. Please try again."
            : `Trade ${tradeRef} is not in your book yet.`}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-foreground hover:border-success/50"
          >
            Try again
          </button>
          <Link href="/trader/trades" className="text-sm text-success hover:underline">
            ← My trades
          </Link>
          <Link href="/trader/trades/new" className="text-sm text-muted-foreground hover:text-foreground">
            Book another trade
          </Link>
        </div>
      </div>
    );
  }

  const creditDaysRaw = trade.tradeParams?.creditDays;
  const creditDays =
    typeof creditDaysRaw === "number"
      ? creditDaysRaw
      : typeof creditDaysRaw === "string"
        ? Number(creditDaysRaw) || undefined
        : undefined;
  const paymentLabel =
    trade.paymentType === "CREDIT"
      ? paymentTypeLabel("CREDIT", creditDays)
      : paymentTypeLabel(trade.paymentType) ?? trade.paymentTerms;
  const unit = trade.quantityUnit ?? trade.commodity.unit ?? "MT";
  const mappedPrice = trade.pricePerCanonicalQty ?? trade.price;
  const notional = trade.quantity * mappedPrice;
  const quotedUnit =
    trade.priceCurrency && trade.priceWeightUnit
      ? priceUnitLabel({ currency: trade.priceCurrency, weightUnit: trade.priceWeightUnit })
      : `${trade.currency}/${unit}`;
  const hasCommission =
    (trade.commissionAmount ?? 0) > 0 ||
    (trade.commissionPerUnit ?? 0) > 0 ||
    (trade.commissionPerMaund ?? 0) > 0;
  const commissionCurrency = trade.priceCurrency ?? (trade.currency === "PKR" ? "PKR" : "USD");
  const commissionInBase =
    trade.commissionAmount != null && trade.commissionAmount > 0
      ? trade.commissionAmount * currencyToBaseFactor(commissionCurrency)
      : 0;
  const netAfterCommission = Math.max(0, notional - commissionInBase);
  /** Gross payable for finance — contract value plus broker commission. */
  const totalWithCommission = notional + commissionInBase;
  // 236G advance income tax on SELL trades — filer/non-filer rates from
  // Finance → Policies; the counterparty's filer status lives in master data.
  const counterpartyRow = refData.data?.counterparties.find(
    (cp) => cp.id === trade.counterparty.id || cp.code === trade.counterparty.code,
  );
  const filerStatus = counterpartyRow?.taxFilerStatus ?? "FILER";
  const advanceTaxRatePct =
    filerStatus === "NON_FILER"
      ? policy.data?.advanceTaxRatePctNonFiler ?? policy.data?.advanceTaxRatePct ?? null
      : policy.data?.advanceTaxRatePct ?? null;
  const advanceTaxAmount =
    trade.direction === "SELL" && notional > 0 && advanceTaxRatePct != null
      ? (notional * advanceTaxRatePct) / 100
      : 0;
  const frozen = trade.settlementRequested === true;
  const canEdit = traderCanEditTrade(trade) && !frozen;
  const paramStr = (v: unknown) => (v == null || v === "" ? null : String(v));
  const contactPerson = paramStr(trade.tradeParams?.contactPerson);
  const contactNumber = paramStr(trade.tradeParams?.contactNumber);
  const dealStatus = paramStr(trade.tradeParams?.dealStatus);
  const quantityTolerance = paramStr(trade.tradeParams?.quantityTolerance);

  return (
    <div className="kastros-desk-page mx-auto w-full max-w-4xl">
      <div className="kastros-desk-scroll space-y-5 pb-6">
      <div>
        <Link href="/trader/trades" className="text-xs text-subtle hover:text-success">
          ← My trades
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold text-foreground">{trade.tradeRef}</h1>
            <p className="text-sm text-subtle">
              Booked {trade.tradeDate.toISOString().slice(0, 10)} · Trader: {trade.traderName} ·{" "}
              {trade.desk.replace("_", " ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20"
              >
                {editing ? <X className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />}
                {editing ? "Back to summary" : "Edit"}
              </button>
            )}
            <span
              className={`rounded-md px-3 py-1 text-sm font-medium ${
              trade.tradeStatus === "PENDING"
                ? "bg-warning/20 text-warning"
                : trade.tradeStatus === "LOCKED"
                  ? "bg-purple-500/20 text-purple-300"
                  : trade.tradeStatus === "EXECUTED" || trade.tradeStatus === "SETTLED"
                    ? "bg-zinc-500/20 text-muted-foreground"
                    : "bg-blue-500/20 text-blue-400"
            }`}
          >
            {trade.tradeStatus === "PENDING"
              ? trade.submittedToExecution
                ? trade.pendingTraderPrice
                  ? "Price required"
                  : trade.pendingTraderReview
                    ? "Execution edits — review"
                    : "With execution"
                : "Draft"
              : trade.tradeStatus === "EXECUTED" || trade.tradeStatus === "SETTLED"
                ? "Closed"
                : trade.tradeStatus}
            </span>
            {trade.settlementRequested && !trade.directSettled && (
              <span className="rounded-md bg-warning/20 px-3 py-1 text-sm font-medium text-warning">
                Settlement pending CEO approval
              </span>
            )}
            {trade.directSettled && (
              <span className="rounded-md bg-success/15 px-3 py-1 text-sm font-medium text-success">
                Directly settled
              </span>
            )}
          </div>
        </div>
      </div>

      {editing && canEdit ? (
        <TradeChangeForm trade={trade} mode={isTraderDraft(trade) ? "direct" : "ceo"} />
      ) : (
        <>

      <DetailCard title="Product specifications">
        <Row label="Commodity" value={`${trade.commodity.code} — ${trade.commodity.name}`} />
        <Row label="Exact grade" value={trade.grade} />
        <Row label="Product origin" value={trade.productOrigin} />
        {trade.maxMoisturePct != null && (
          <Row label="Max moisture" value={`${trade.maxMoisturePct}%`} />
        )}
        <Row label="Quality tolerances" value={trade.qualityTolerances} multiline />
      </DetailCard>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          {
            label: "Direction",
            value: trade.direction,
            tone: trade.direction === "BUY" ? "text-success" : "text-kastros-red",
          },
          {
            label: "Market",
            value: TRADE_SCOPE_LABELS[trade.tradeScope ?? "LOCAL"],
          },
          {
            label: "Incoterm",
            value: executionIncotermLabel(trade.incoterms),
          },
          { label: "Quantity", value: `${formatQty(trade.quantity)} MT` },
          ...(trade.quantityEntered != null && trade.quantityEnteredUnit
            ? [
                {
                  label: "Booked as",
                  value: `${trade.quantityEntered.toLocaleString()} ${trade.quantityEnteredUnit}`,
                },
              ]
            : []),
          {
            label: "Quoted price",
            value: trade.pendingTraderPrice
              ? "Pending — enter below"
              : trade.price > 0
                ? `${trade.price.toLocaleString()} ${quotedUnit}`
                : "—",
          },
          ...(trade.pendingTraderPrice
            ? []
            : [
                {
                  label: `Mapped price / ${unit}`,
                  value: `${formatCurrency(mappedPrice, trade.currency)} / ${unit}`,
                },
              ]),
          { label: "Price basis", value: trade.priceBasis },
          ...(hasCommission
            ? [
                {
                  label: "Broker commission",
                  value:
                    trade.commissionAmount != null && trade.commissionAmount > 0
                      ? `${trade.commissionAmount.toLocaleString()} ${quotedCurrencyLabel(commissionCurrency)}`
                      : `${(trade.commissionPerUnit ?? trade.commissionPerMaund ?? 0).toLocaleString()} ${quotedUnit}`,
                  tone: "text-warning",
                },
                ...(commissionInBase > 0
                  ? [
                      {
                        label: "Net after commission",
                        value: formatCurrency(netAfterCommission, trade.currency),
                        tone: "text-success",
                      },
                      {
                        label: "Total trade price",
                        value: formatCurrency(totalWithCommission, trade.currency),
                        tone: "font-semibold",
                      },
                    ]
                  : []),
              ]
            : []),
          { label: "Notional", value: formatCurrency(notional, trade.currency) },
          ...(trade.direction === "SELL" && advanceTaxAmount > 0 && advanceTaxRatePct != null
            ? [
                {
                  label: `236G advance tax (${advanceTaxRatePct}% — ${
                    filerStatus === "NON_FILER" ? "non-filer" : "filer"
                  })`,
                  value: formatCurrency(advanceTaxAmount, trade.currency),
                  tone: "text-warning",
                },
                {
                  label: "Total receivable (incl. 236G)",
                  value: formatCurrency(notional + advanceTaxAmount, trade.currency),
                  tone: "font-semibold",
                },
              ]
            : []),
          {
            label: "MTM P&L",
            value: formatCurrency(trade.mtmPnl, trade.currency),
            tone: trade.mtmPnl >= 0 ? "text-success" : "text-kastros-red",
          },
          { label: "Market", value: formatCurrency(trade.marketPrice, trade.currency) },
          { label: "Payment type", value: paymentLabel },
        ].map((item, index) => (
          <div key={`${item.label}-${index}`} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5">
            <div className="text-xs uppercase text-subtle">{item.label}</div>
            <div className={`mt-1 text-sm font-medium ${"tone" in item ? item.tone : "text-foreground"}`}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailCard title="Delivery terms (Incoterms)">
          <Row label="Incoterms" value={executionIncotermLabel(trade.incoterms)} />
          <Row label="Delivery start" value={trade.deliveryStart.toISOString().slice(0, 10)} />
          <Row label="Delivery end" value={trade.deliveryEnd.toISOString().slice(0, 10)} />
          {trade.originName?.trim() ? (
            <Row label="Origin / load point" value={trade.originName} />
          ) : null}
          {(() => {
            const warehouses = parseTraderWarehouseSelections(trade.tradeParams ?? null);
            if (!warehouses.length) return null;
            return (
              <Row
                label={warehouses.length > 1 ? "Warehouses" : "Warehouse"}
                value={warehouses.join(", ")}
              />
            );
          })()}
          {dealStatus && <Row label="Deal status" value={dealStatus} />}
          {quantityTolerance && <Row label="Quantity tolerance" value={quantityTolerance} />}
        </DetailCard>

        <DetailCard title="Counterparty">
          <Row label="Counterparty" value={trade.counterparty.name} />
          <Row label="Code" value={trade.counterparty.code} />
          {trade.counterparty.companyNameNtn && (
            <Row label="Company (as per NTN)" value={trade.counterparty.companyNameNtn} />
          )}
          {trade.counterparty.ntn && <Row label="NTN no." value={trade.counterparty.ntn} />}
          {contactPerson && <Row label="Contact person" value={contactPerson} />}
          {contactNumber && <Row label="Contact number" value={contactNumber} />}
          {trade.counterparty.address && (
            <Row label="Address" value={trade.counterparty.address} multiline />
          )}
          {trade.counterparty.bankDetails && (
            <Row label="Bank details" value={trade.counterparty.bankDetails} multiline />
          )}
        </DetailCard>
      </div>

      {trade.tradeParams && Object.keys(trade.tradeParams).length > 0 && (() => {
        const defs = resolveAllTradeParameters(trade.commodity.code, null);
        const labelOf = (key: string) => defs.find((d) => d.key === key)?.label ?? key.replace(/_/g, " ");
        const universalKeys = new Set([
          ...UNIVERSAL_TRADE_FIELDS.map((d) => d.key),
          "warehouse",
          "warehouseSelections",
        ]);
        // Rendered inside the Counterparty / Delivery terms cards above — not repeated here.
        const relocatedKeys = new Set([
          "contactPerson",
          "contactNumber",
          "dealStatus",
          "quantityTolerance",
        ]);
        const universal = Object.entries(trade.tradeParams).filter(
          ([k, v]) =>
            universalKeys.has(k) &&
            !relocatedKeys.has(k) &&
            k !== "warehouse" &&
            k !== "warehouseSelections" &&
            v != null &&
            v !== "",
        );
        const commodity = Object.entries(trade.tradeParams).filter(
          ([k, v]) =>
            !universalKeys.has(k) &&
            !relocatedKeys.has(k) &&
            k !== "warehouse" &&
            k !== "warehouseSelections" &&
            v != null &&
            v !== "",
        );

        return (
          <>
            {universal.length > 0 && (
              <DetailCard title="Contract details">
                {universal.map(([key, val]) => (
                  <Row key={key} label={labelOf(key)} value={String(val)} multiline={key === "otherTerms"} />
                ))}
              </DetailCard>
            )}
            {commodity.length > 0 && (
              <DetailCard title={`${trade.commodity.name} specifications`}>
                {commodity.map(([key, val]) => (
                  <Row key={key} label={labelOf(key)} value={String(val)} />
                ))}
              </DetailCard>
            )}
          </>
        );
      })()}

      {trade.contractRef && (
        <DetailCard title="Contract">
          <Row label="Contract ref" value={trade.contractRef} />
        </DetailCard>
      )}

      {trade.notes && (
        <DetailCard title="Notes">
          <p className="text-sm text-muted-foreground">{trade.notes}</p>
        </DetailCard>
      )}

      {trade.tradeStatus === "PENDING" && trade.submittedToExecution && trade.pendingTraderPrice && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <div className="font-medium">Price required</div>
          <p className="mt-1 text-xs text-warning/90">
            This trade was booked as {trade.priceBasis} without a fixed price. Enter the price below to save it
            directly — no approval is needed. Execution cannot lock the contract until the price is set.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-warning/90">
              Price ({quotedUnit})
              <input
                type="number"
                min={0}
                step="any"
                value={priceInput || ""}
                onChange={(e) => setPriceInput(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground data-grid"
              />
            </label>
            <label className="text-xs text-warning/90">
              Broker commission ({quotedUnit}) — optional
              <input
                type="number"
                min={0}
                step="any"
                value={commissionInput || ""}
                onChange={(e) => setCommissionInput(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground data-grid"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={completePrice.isPending || !(priceInput > 0)}
            onClick={() =>
              completePrice.mutate({
                tradeRef,
                price: priceInput,
                commissionPerUnit: commissionInput > 0 ? commissionInput : undefined,
                priceKgPerUnit: defaultKgPerUnit(
                  trade.priceWeightUnit ?? trade.quantityUnit ?? "MT",
                ),
              })
            }
            className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
          >
            {completePrice.isPending ? "Saving…" : "Save price"}
          </button>
          {completePrice.error && (
            <p className="mt-2 text-xs text-kastros-red">{completePrice.error.message}</p>
          )}
        </div>
      )}

      {trade.tradeStatus === "PENDING" && trade.submittedToExecution && trade.pendingTraderReview && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <div className="font-medium">Execution changed this trade</div>
          <p className="mt-1 text-xs text-warning/90">
            {trade.executionLastEditedBy
              ? `Edited by ${trade.executionLastEditedBy}`
              : "The execution team edited fields on this contract"}
            {trade.executionLastEditedAt
              ? ` · ${new Date(trade.executionLastEditedAt).toLocaleString()}`
              : ""}
          </p>
          {trade.executionEditNote && (
            <p className="mt-2 text-xs text-muted-foreground">{trade.executionEditNote}</p>
          )}
          <p className="mt-2 text-xs text-subtle">
            Review the details above, then approve the changes.
          </p>
          <button
            type="button"
            disabled={approveEdits.isPending}
            onClick={() => approveEdits.mutate({ tradeRef })}
            className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
          >
            {approveEdits.isPending ? "Approving…" : "Approve changes"}
          </button>
          <p className="mt-2 text-xs text-subtle">After you approve, execution locks the contract.</p>
          {approveEdits.error && (
            <p className="mt-2 text-xs text-kastros-red">{approveEdits.error.message}</p>
          )}
        </div>
      )}

      {trade.tradeStatus === "PENDING" &&
        trade.submittedToExecution &&
        !trade.pendingTraderReview &&
        !trade.pendingTraderPrice && (
        <div className="rounded-lg border border-accent-secondary/30 bg-accent-secondary/10 p-4 text-sm text-accent-secondary">
          <div className="font-medium">With execution team</div>
          <p className="mt-1 text-xs text-subtle">
            This trade is in Unreviewed Trades. Execution will allocate warehouse and lock it, or edit fields and
            send back for your review.
          </p>
        </div>
      )}

      {trade.tradeStatus === "PENDING" && !trade.submittedToExecution && !frozen && (
        <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Submit to execution</h2>
          <p className="mt-1 text-xs text-subtle">
            This draft is only visible to you. Submit it to the execution desk Unreviewed Trades queue when ready.
          </p>
          <button
            type="button"
            disabled={submitToExecution.isPending}
            onClick={() => submitToExecution.mutate({ tradeRef })}
            className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
          >
            {submitToExecution.isPending ? "Submitting…" : "Submit to execution"}
          </button>
          {submitToExecution.error && (
            <p className="mt-2 text-xs text-kastros-red">{submitToExecution.error.message}</p>
          )}
        </div>
      )}

      {trade.tradeStatus === "PENDING" &&
        !trade.submittedToExecution &&
        !trade.lockedAt &&
        !trade.settlementRequested &&
        !trade.directSettled && (
        <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Settle directly</h2>
          <p className="mt-1 text-xs text-subtle">
            Direct settlement closes the trade with no delivery or gatepass and needs CEO approval. Only possible
            before the trade is locked.
          </p>
          {settling ? (
            <div className="mt-3 space-y-2">
              <label className="block text-xs text-muted-foreground">
                Reason for direct settlement (no delivery) *
                <textarea
                  required
                  rows={3}
                  value={settlementReason}
                  onChange={(e) => setSettlementReason(e.target.value)}
                  placeholder="Why is this trade being settled directly?"
                  className="kastros-input mt-1 w-full text-sm"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={requestSettlement.isPending || !settlementReason.trim()}
                  onClick={() => requestSettlement.mutate({ tradeRef, note: settlementReason.trim() })}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
                >
                  {requestSettlement.isPending ? "Requesting…" : "Request direct settlement"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettling(false);
                    setSettlementReason("");
                  }}
                  className="rounded-md border border-kastros-border px-4 py-2 text-sm text-muted-foreground hover:bg-foreground/5"
                >
                  Cancel
                </button>
              </div>
              {requestSettlement.error && (
                <p className="text-xs text-kastros-red">{requestSettlement.error.message}</p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSettling(true)}
              className="mt-3 rounded-md border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/20"
            >
              Settle directly
            </button>
          )}
        </div>
      )}

      {trade.settlementRequested && !trade.directSettled && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <div className="font-medium">Settlement pending CEO approval</div>
          <p className="mt-1 text-xs text-warning/90">
            This trade is frozen while direct settlement is pending — it can&apos;t be submitted, locked, or edited.
            Direct settlement closes the trade with no delivery or gatepass.
          </p>
          {trade.settlementNote && (
            <p className="mt-2 text-xs text-muted-foreground">Reason: {trade.settlementNote}</p>
          )}
          {trade.settlementRequestedAt && (
            <p className="mt-1 text-xs text-subtle">
              Requested {format(new Date(trade.settlementRequestedAt), "d MMM yyyy HH:mm")}
              {trade.settlementRequestedBy ? ` · ${trade.settlementRequestedBy}` : ""}
            </p>
          )}
          <button
            type="button"
            disabled={cancelSettlement.isPending}
            onClick={() => cancelSettlement.mutate({ tradeRef })}
            className="mt-3 rounded-md border border-kastros-border px-4 py-2 text-sm text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
          >
            {cancelSettlement.isPending ? "Cancelling…" : "Cancel request"}
          </button>
          {cancelSettlement.error && (
            <p className="mt-2 text-xs text-kastros-red">{cancelSettlement.error.message}</p>
          )}
        </div>
      )}

      {trade.directSettled && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success">
          <div className="font-medium">Directly settled</div>
          <p className="mt-1 text-xs text-success/90">Closed with no delivery or gatepass.</p>
          {(trade.settlementApprovedAt || trade.settlementApprovedBy) && (
            <p className="mt-1 text-xs text-subtle">
              Settled{" "}
              {trade.settlementApprovedAt
                ? format(new Date(trade.settlementApprovedAt), "d MMM yyyy HH:mm")
                : "—"}
              {trade.settlementApprovedBy ? ` · approved by ${trade.settlementApprovedBy}` : ""}
            </p>
          )}
        </div>
      )}

      {trade.tradeStatus === "LOCKED" && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-4 text-sm text-purple-200">
          <div className="font-medium">Locked for execution</div>
          <p className="mt-1 text-xs text-purple-200/90">
            Price, quantity, and commission cannot be changed — this contract drives inventory and warehouse
            utilization. Use Fulfillment to close when complete.
          </p>
          {trade.lockedAt && (
            <span className="text-xs text-purple-300/80">
              Locked{" "}
              {trade.lockedAt instanceof Date ? trade.lockedAt.toISOString().slice(0, 16) : String(trade.lockedAt)}
            </span>
          )}
          {trade.executionProfile && (
            <div className="mt-1 text-xs">{trade.executionProfile.replace(/_/g, " ")}</div>
          )}
          <ExecutionWorkspaceLink profile={trade.executionProfile} tradeRef={trade.tradeRef} />
        </div>
      )}

      <TradeActivityPanel tradeRef={trade.tradeRef} audience="trader" />
        </>
      )}
      </div>
    </div>
  );
}

function ExecutionWorkspaceLink({
  profile,
  tradeRef,
}: {
  profile: string | null | undefined;
  tradeRef: string;
}) {
  return (
    <Link
      href={executionWorkspacePath(tradeRef, profile)}
      className="mt-2 inline-block text-xs text-warning hover:underline"
    >
      Open in execution portal →
    </Link>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  multiline,
  tone,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  tone?: string;
}) {
  return (
    <div className={multiline ? "space-y-1 text-sm" : "flex justify-between gap-4 text-sm"}>
      <span className="shrink-0 text-subtle">{label}</span>
      <span className={`${multiline ? "block text-muted-foreground" : "text-right text-foreground"} ${tone ?? ""}`}>
        {value}
      </span>
    </div>
  );
}

"use client";

import { TRADE_SCOPE_LABELS, executionIncotermLabel, paymentTypeLabel } from "@/lib/trade-constants";
import { parseTraderWarehouseSelections } from "@/lib/warehouse-allocation";
import { priceUnitLabel, quotedCurrencyLabel, currencyToBaseFactor } from "@/lib/price-units";
import { resolveAllTradeParameters, UNIVERSAL_TRADE_FIELDS } from "@/lib/trade-parameters";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import { executionWorkspacePath } from "@/lib/execution-routes";
import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
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
  const lock = trpc.trader.lockTrade.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils, tradeRef),
  });
  const submitToExecution = trpc.trader.submitTradeToExecution.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils, tradeRef),
  });
  const [ratePerMaund, setRatePerMaund] = useState<number>(0);
  const [commission, setCommission] = useState<number>(0);

  useEffect(() => {
    if (trade?.ratePerMaund) setRatePerMaund(trade.ratePerMaund);
    if (trade?.commissionPerMaund != null) setCommission(trade.commissionPerMaund);
  }, [trade?.ratePerMaund, trade?.commissionPerMaund]);

  useEffect(() => {
    if (typeof window === "undefined" || !trade) return;
    if (window.location.hash === `#${TRADE_EDIT_SECTION_ID}`) {
      document.getElementById(TRADE_EDIT_SECTION_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
            {traderCanEditTrade(trade) && (
              <a
                href={`#${TRADE_EDIT_SECTION_ID}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20"
              >
                <PenLine className="h-3.5 w-3.5" />
                Edit
              </a>
            )}
            <span
              className={`rounded-md px-3 py-1 text-sm font-medium ${
              trade.tradeStatus === "PENDING"
                ? "bg-warning/20 text-warning"
                : trade.tradeStatus === "LOCKED"
                  ? "bg-purple-500/20 text-purple-300"
                  : trade.tradeStatus === "EXECUTED" || trade.tradeStatus === "SETTLED"
                    ? "bg-zinc-500/20 text-muted-foreground"
                    : "bg-backgroundlue-500/20 text-blue-400"
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
          </div>
        </div>
      </div>

      {traderCanEditTrade(trade) && (
        <TradeChangeForm trade={trade} mode={isTraderDraft(trade) ? "direct" : "ceo"} />
      )}

      <TradeActivityPanel tradeRef={trade.tradeRef} audience="trader" />

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
                    ]
                  : []),
              ]
            : []),
          { label: "Notional", value: formatCurrency(notional, trade.currency) },
          {
            label: "MTM P&L",
            value: formatCurrency(trade.mtmPnl, trade.currency),
            tone: trade.mtmPnl >= 0 ? "text-success" : "text-kastros-red",
          },
          { label: "Market", value: formatCurrency(trade.marketPrice, trade.currency) },
          { label: "Payment type", value: paymentLabel },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5">
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
        </DetailCard>

        <DetailCard title="Counterparty">
          <Row label="Counterparty" value={trade.counterparty.name} />
          <Row label="Code" value={trade.counterparty.code} />
          {trade.counterparty.companyNameNtn && (
            <Row label="Company (as per NTN)" value={trade.counterparty.companyNameNtn} />
          )}
          {trade.counterparty.ntn && <Row label="NTN no." value={trade.counterparty.ntn} />}
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
        const universal = Object.entries(trade.tradeParams).filter(
          ([k, v]) =>
            universalKeys.has(k) &&
            k !== "warehouse" &&
            k !== "warehouseSelections" &&
            v != null &&
            v !== "",
        );
        const commodity = Object.entries(trade.tradeParams).filter(
          ([k, v]) =>
            !universalKeys.has(k) &&
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
          <div className="font-medium">Price required — submit via edit form above</div>
          <p className="mt-1 text-xs text-warning/90">
            This trade was booked as {trade.priceBasis} without a fixed price. Enter the price and quantity in the
            edit form above and submit for CEO approval. Execution cannot lock until the CEO approves your price.
          </p>
        </div>
      )}

      {trade.tradeStatus === "PENDING" && trade.submittedToExecution && trade.pendingTraderReview && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <div className="font-medium">Execution updated this trade</div>
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
            Review the details below, then lock the trade to confirm and send it to Reviewed Trades.
          </p>
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

      {trade.tradeStatus === "PENDING" && !trade.submittedToExecution && (
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

      {trade.tradeStatus === "PENDING" && trade.submittedToExecution && trade.pendingTraderReview && (
        <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Lock after review</h2>
          <p className="mt-1 text-xs text-subtle">
            Confirm you have reviewed execution&apos;s changes. Locking moves this contract to Reviewed Trades.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              type="number"
              placeholder="Override rate per maund (optional)"
              value={ratePerMaund || ""}
              onChange={(e) => setRatePerMaund(Number(e.target.value))}
              className="rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
            />
            <input
              type="number"
              placeholder="Override commission / maund (optional)"
              value={commission || ""}
              onChange={(e) => setCommission(Number(e.target.value))}
              className="rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-foreground"
            />
          </div>
          <button
            type="button"
            disabled={lock.isPending}
            onClick={() =>
              lock.mutate({
                tradeRef,
                ratePerMaund: ratePerMaund || undefined,
                commissionPerMaund: commission || undefined,
              })
            }
            className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
          >
            {lock.isPending ? "Locking…" : "Lock trade"}
          </button>
          {lock.error && <p className="mt-2 text-xs text-kastros-red">{lock.error.message}</p>}
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

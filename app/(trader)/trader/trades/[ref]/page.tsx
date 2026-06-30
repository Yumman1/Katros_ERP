"use client";

import { TRADE_SCOPE_LABELS, executionIncotermLabel, executionProfileFromTrade, PAYMENT_TYPE_LABELS } from "@/lib/trade-constants";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import { executionWorkspacePath } from "@/lib/execution-routes";
import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

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
  const [ratePerMaund, setRatePerMaund] = useState<number>(0);
  const [commission, setCommission] = useState<number>(0);

  useEffect(() => {
    if (trade?.ratePerMaund) setRatePerMaund(trade.ratePerMaund);
    if (trade?.commissionPerMaund != null) setCommission(trade.commissionPerMaund);
  }, [trade?.ratePerMaund, trade?.commissionPerMaund]);

  if (isLoading || (isFetching && !trade)) {
    return <div className="animate-pulse text-zinc-500">Loading trade…</div>;
  }

  if (!trade) {
    return (
      <div className="space-y-3">
        <p className="text-zinc-400">
          {isError
            ? "Could not load this trade. Please try again."
            : `Trade ${tradeRef} is not in your book yet.`}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-white hover:border-kastros-green/50"
          >
            Try again
          </button>
          <Link href="/trader/trades" className="text-sm text-kastros-green hover:underline">
            ← My trades
          </Link>
          <Link href="/trader/trades/new" className="text-sm text-zinc-400 hover:text-white">
            Book another trade
          </Link>
        </div>
      </div>
    );
  }

  const notional = trade.quantity * trade.price;
  const paymentLabel = PAYMENT_TYPE_LABELS[trade.paymentType] ?? trade.paymentTerms;
  const unit = trade.quantityUnit ?? trade.commodity.unit ?? "MT";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href="/trader/trades" className="text-xs text-zinc-500 hover:text-kastros-green">
          ← My trades
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-2xl font-semibold text-white">{trade.tradeRef}</h1>
            <p className="text-sm text-zinc-500">
              Booked {trade.tradeDate.toISOString().slice(0, 10)} · Trader: {trade.traderName} ·{" "}
              {trade.desk.replace("_", " ")}
            </p>
          </div>
          <span
            className={`rounded-md px-3 py-1 text-sm font-medium ${
              trade.tradeStatus === "PENDING"
                ? "bg-amber-500/20 text-amber-400"
                : trade.tradeStatus === "LOCKED"
                  ? "bg-purple-500/20 text-purple-300"
                  : trade.tradeStatus === "EXECUTED" || trade.tradeStatus === "SETTLED"
                    ? "bg-zinc-500/20 text-zinc-400"
                    : "bg-blue-500/20 text-blue-400"
            }`}
          >
            {trade.tradeStatus === "PENDING"
              ? "Draft"
              : trade.tradeStatus === "EXECUTED" || trade.tradeStatus === "SETTLED"
                ? "Closed"
                : trade.tradeStatus}
          </span>
        </div>
      </div>

      <DetailCard title="Product specifications">
        <Row label="Commodity" value={`${trade.commodity.code} — ${trade.commodity.name}`} />
        <Row label="Exact grade" value={trade.grade} />
        <Row label="Product origin" value={trade.productOrigin} />
        <Row label="Max moisture" value={`${trade.maxMoisturePct}%`} />
        <Row label="Quality tolerances" value={trade.qualityTolerances} multiline />
      </DetailCard>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          {
            label: "Direction",
            value: trade.direction,
            tone: trade.direction === "BUY" ? "text-kastros-green" : "text-kastros-red",
          },
          {
            label: "Market",
            value: TRADE_SCOPE_LABELS[trade.tradeScope ?? "LOCAL"],
          },
          {
            label: "Workflow",
            value: executionIncotermLabel(trade.incoterms),
          },
          { label: "Quantity", value: `${formatQty(trade.quantity)} ${unit}` },
          {
            label: `Price / ${unit}`,
            value: `${formatCurrency(trade.price, trade.currency)} / ${unit}`,
          },
          { label: "Price basis", value: trade.priceBasis },
          { label: "Notional", value: formatCurrency(notional, trade.currency) },
          {
            label: "MTM P&L",
            value: formatCurrency(trade.mtmPnl, trade.currency),
            tone: trade.mtmPnl >= 0 ? "text-kastros-green" : "text-kastros-red",
          },
          { label: "Market", value: formatCurrency(trade.marketPrice, trade.currency) },
          { label: "Payment type", value: paymentLabel },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5">
            <div className="text-xs uppercase text-zinc-500">{item.label}</div>
            <div className={`mt-1 text-sm font-medium ${"tone" in item ? item.tone : "text-white"}`}>
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailCard title="Delivery terms (Incoterms)">
          <Row label="Incoterms" value={trade.incoterms} />
          <Row label="Execution workflow" value={executionProfileFromTrade(trade.direction, trade.buyingCategory, trade.incoterms).replace(/_/g, " ")} />
          <Row label="Delivery start" value={trade.deliveryStart.toISOString().slice(0, 10)} />
          <Row label="Delivery end" value={trade.deliveryEnd.toISOString().slice(0, 10)} />
          <Row label="Shipment origin" value={trade.originName} />
          <Row label="Destination" value={trade.destName} />
        </DetailCard>

        <DetailCard title="Counterparty & KYC">
          <Row label="Counterparty" value={trade.counterparty.name} />
          <Row label="Code" value={trade.counterparty.code} />
          <Row
            label="KYC status"
            value={trade.counterpartyKycStatus}
            tone={trade.counterpartyKycStatus === "VERIFIED" ? "text-kastros-green" : "text-amber-400"}
          />
          {trade.counterpartyKycRef && <Row label="KYC reference" value={trade.counterpartyKycRef} />}
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

      {trade.contractRef && (
        <DetailCard title="Contract">
          <Row label="Contract ref" value={trade.contractRef} />
        </DetailCard>
      )}

      {trade.notes && (
        <DetailCard title="Notes">
          <p className="text-sm text-zinc-400">{trade.notes}</p>
        </DetailCard>
      )}

      {trade.tradeStatus === "PENDING" && (
        <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
          <h2 className="text-sm font-medium text-zinc-300">Lock for execution</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Execution only sees this trade after you lock it. Workflow is set by Incoterms:{" "}
            <strong className="text-amber-400/90">{executionIncotermLabel(trade.incoterms)}</strong>
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              type="number"
              placeholder={`Rate per maund (default ${trade.price})`}
              value={ratePerMaund || trade.price}
              onChange={(e) => setRatePerMaund(Number(e.target.value))}
              className="rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
            />
            <input
              type="number"
              placeholder="Commission / maund"
              value={commission}
              onChange={(e) => setCommission(Number(e.target.value))}
              className="rounded-md border border-kastros-border bg-kastros-bg px-3 py-2 text-sm text-white"
            />
          </div>
          <button
            type="button"
            disabled={lock.isPending}
            onClick={() =>
              lock.mutate({
                tradeRef,
                ratePerMaund: ratePerMaund || trade.price,
                commissionPerMaund: commission,
              })
            }
            className="mt-3 rounded-md bg-kastros-green px-4 py-2 text-sm font-semibold text-kastros-bg disabled:opacity-50"
          >
            {lock.isPending ? "Locking…" : "Lock for execution"}
          </button>
          {lock.error && <p className="mt-2 text-xs text-kastros-red">{lock.error.message}</p>}
        </div>
      )}

      {trade.tradeStatus === "LOCKED" && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-4 text-sm text-purple-200">
          <div className="font-medium">Locked for execution</div>
          {trade.lockedAt && (
            <span className="text-xs text-purple-300/80">
              {" "}
              · {trade.lockedAt instanceof Date ? trade.lockedAt.toISOString().slice(0, 16) : String(trade.lockedAt)}
            </span>
          )}
          {trade.executionProfile && (
            <div className="mt-1 text-xs">{trade.executionProfile.replace(/_/g, " ")}</div>
          )}
          <ExecutionWorkspaceLink profile={trade.executionProfile} tradeRef={trade.tradeRef} />
        </div>
      )}
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
      className="mt-2 inline-block text-xs text-amber-400 hover:underline"
    >
      Open in execution portal →
    </Link>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
      <h2 className="text-sm font-medium text-zinc-300">{title}</h2>
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
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className={`${multiline ? "block text-zinc-300" : "text-right text-zinc-200"} ${tone ?? ""}`}>
        {value}
      </span>
    </div>
  );
}

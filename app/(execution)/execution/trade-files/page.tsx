"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";

import { PageHeader } from "@/components/ui/page-header";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { executionIncotermLabel, TRADE_SCOPES, TRADE_SCOPE_LABELS } from "@/lib/trade-constants";
import { downloadCsvAsExcel } from "@/lib/export-excel";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { endOfMonth, startOfMonth } from "date-fns";
import { Download, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

export default function TradeFilesPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [commodityCode, setCommodityCode] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [direction, setDirection] = useState<"" | "BUY" | "SELL">("");
  const [tradeScope, setTradeScope] = useState<"" | "LOCAL" | "INTERNATIONAL">("");
  const [tradeStatus, setTradeStatus] = useState("");
  const [incoterms, setIncoterms] = useState("");
  const [traderName, setTraderName] = useState("");
  const [exported, setExported] = useState(false);

  const { data: options } = trpc.execution.tradeFileOptions.useQuery();

  const [dateMode, setDateMode] = useState<"range" | "day">("range");
  const filter = useMemo(
    () => ({
      fromDay: from || undefined,
      toDay: (dateMode === "day" ? from : to) || undefined,
      commodityCode: commodityCode || undefined,
      counterpartyId: counterpartyId || undefined,
      direction: direction || undefined,
      tradeScope: tradeScope || undefined,
      tradeStatus: tradeStatus || undefined,
      incoterms: incoterms || undefined,
      traderName: traderName || undefined,
    }),
    [dateMode, from, to, commodityCode, counterpartyId, direction, tradeScope, tradeStatus, incoterms, traderName],
  );

  const { data: preview } = trpc.execution.tradeFilePreview.useQuery(filter);

  const exportMutation = trpc.execution.exportTradeFileCsv.useMutation({
    onSuccess: (res) => {
      downloadCsvAsExcel(res.csv, "TradeFile", res.filename);
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    },
  });

  function applyThisMonth() {
    setDateMode("range");
    const now = new Date();
    setFrom(startOfMonth(now).toISOString().slice(0, 10));
    setTo(endOfMonth(now).toISOString().slice(0, 10));
  }

  function clearFilters() {
    setDateMode("range");
    setFrom("");
    setTo("");
    setCommodityCode("");
    setCounterpartyId("");
    setDirection("");
    setTradeScope("");
    setTradeStatus("");
    setIncoterms("");
    setTraderName("");
  }

  const hasFilters =
    from ||
    to ||
    commodityCode ||
    counterpartyId ||
    direction ||
    tradeScope ||
    tradeStatus ||
    incoterms ||
    traderName;

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Trade Files</span>
          </>
        }
        title="Trade File Export"
        subtitle="Download the full booking record for every trade — contract fields, quality specs, and all accumulated trade parameters."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="exec-panel space-y-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-accent-secondary" />
            <h2 className="text-sm font-semibold text-foreground">Filters</h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={applyThisMonth} className="kastros-btn-secondary text-xs">
              This month
            </button>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="kastros-btn-ghost text-xs">
                Clear all
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Trade date selection">
              <SearchableSelect className="kastros-select w-full" value={dateMode} onChange={(e) => { setDateMode(e.target.value as "range" | "day"); setFrom(""); setTo(""); }}><option value="range">Date range / all dates</option><option value="day">Specific date</option></SearchableSelect>
            </Field>
            <Field label={dateMode === "day" ? "Trade date" : "Booked from"}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="kastros-input w-full" />
            </Field>
            {dateMode === "range" && <Field label="Booked to (inclusive)">
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="kastros-input w-full" />
            </Field>}
            <Field label="Commodity">
              <SearchableSelect value={commodityCode} onChange={(e) => setCommodityCode(e.target.value)} className="kastros-select w-full">
                <option value="">All commodities</option>
                {(options?.commodities ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Counterparty">
              <SearchableSelect value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} className="kastros-select w-full">
                <option value="">All counterparties</option>
                {(options?.counterparties ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Direction">
              <SearchableSelect
                value={direction}
                onChange={(e) => setDirection(e.target.value as "" | "BUY" | "SELL")}
                className="kastros-select w-full"
              >
                <option value="">Buy &amp; Sell</option>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
              </SearchableSelect>
            </Field>
            <Field label="Market">
              <SearchableSelect
                value={tradeScope}
                onChange={(e) => setTradeScope(e.target.value as "" | "LOCAL" | "INTERNATIONAL")}
                className="kastros-select w-full"
              >
                <option value="">All markets</option>
                {TRADE_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {TRADE_SCOPE_LABELS[s]}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Status">
              <SearchableSelect value={tradeStatus} onChange={(e) => setTradeStatus(e.target.value)} className="kastros-select w-full">
                <option value="">All statuses</option>
                {(options?.statuses ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Incoterm">
              <SearchableSelect value={incoterms} onChange={(e) => setIncoterms(e.target.value)} className="kastros-select w-full">
                <option value="">All incoterms</option>
                {(options?.incoterms ?? []).map((i) => (
                  <option key={i} value={i}>
                    {executionIncotermLabel(i)}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
            <Field label="Trader" className="sm:col-span-2">
              <SearchableSelect value={traderName} onChange={(e) => setTraderName(e.target.value)} className="kastros-select w-full">
                <option value="">All traders</option>
                {(options?.traders ?? []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </SearchableSelect>
            </Field>
          </div>

          <button
            type="button"
            onClick={() => exportMutation.mutate(filter)}
            disabled={exportMutation.isPending || (preview?.count ?? 0) === 0}
            className={cn(
              "kastros-btn-primary flex w-full items-center justify-center gap-2 py-3",
              exported && "bg-success text-accent-foreground",
            )}
          >
            <Download className="h-4 w-4" />
            {exportMutation.isPending
              ? "Generating…"
              : exported
                ? "Downloaded!"
                : `Export Excel (${preview?.count ?? 0} trades)`}
          </button>
        </section>

        <section className="exec-panel">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Preview ({preview?.count ?? 0} trades)</h2>
          <p className="mb-4 text-xs text-subtle">
            Each row in the CSV includes every booking field plus flattened trade parameters (broker, quality, logistics,
            etc.).
          </p>
          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {(preview?.trades ?? []).map((t) => (
              <div
                key={t.tradeRef}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
              >
                <div>
                  <span className="font-mono text-xs font-semibold text-accent-secondary">{t.tradeRef}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{t.counterpartyName}</span>
                  <span className="ml-2 text-[10px] text-subtle">{t.commodityCode}</span>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatQtyWithUnit(t.quantity, t.quantityUnit, 2)}
                </span>
              </div>
            ))}
            {(preview?.count ?? 0) === 0 && (
              <div className="py-12 text-center text-sm text-subtle">No trades match these filters.</div>
            )}
            {(preview?.count ?? 0) > 25 && (
              <p className="pt-2 text-center text-xs text-subtle">Showing first 25 of {preview?.count} trades</p>
            )}
          </div>
        </section>
      </div>

      <section className="exec-panel">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Included in trade file</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Core contract columns, counterparty KYC, pricing metrics, delivery window, quality tolerances, and every
          commodity-specific parameter entered at booking (prefixed as <code className="text-foreground">param_*</code>
          ).
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            "tradeRef",
            "commodityCode",
            "counterpartyName",
            "quantity",
            "price",
            "incoterms",
            "deliveryStart",
            "grade",
            "param_brokerName",
            "param_warehouse",
            "param_moisture",
          ].map((col) => (
            <span key={col} className="rounded border border-border bg-card px-2 py-1 font-mono text-[10px] text-subtle">
              {col}
            </span>
          ))}
          <span className="px-2 py-1 text-[10px] text-subtle">+ all other booking fields</span>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

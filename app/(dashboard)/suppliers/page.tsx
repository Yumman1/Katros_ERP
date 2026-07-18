"use client";

import { COUNTERPARTY_TYPE_LABELS } from "@/lib/trade-constants";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatPct } from "@/lib/formatters/numbers";
import { downloadExcel } from "@/lib/export-excel";
import { Download } from "lucide-react";
import { useState } from "react";

type Filter = "ALL" | "SELLER" | "BUYER";

export default function SuppliersPage() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const { data: counterparties, isLoading } = trpc.supplyChain.counterparties.useQuery({
    type: filter === "ALL" ? undefined : filter,
  });

  if (isLoading) {
    return <div className="animate-pulse text-subtle">Loading supplier network…</div>;
  }

  const sellers = counterparties?.filter((c) => c.type === "SELLER") ?? [];
  const avgOtd =
    sellers.length > 0 ? sellers.reduce((a, c) => a + c.onTimeDeliveryPct, 0) / sellers.length : 0;

  function exportCounterparties() {
    if (!counterparties?.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadExcel(
      counterparties.map((cp) => ({
        Code: cp.code,
        Name: cp.name,
        Type: COUNTERPARTY_TYPE_LABELS[cp.type] ?? cp.type,
        Country: cp.country,
        "KYC status": cp.kycStatus,
        NTN: cp.ntn ?? "",
        "Company (NTN)": cp.companyNameNtn ?? "",
        Address: cp.address ?? "",
        "Bank details": cp.bankDetails ?? "",
        "Credit limit": cp.creditLimit,
        "Active trades": cp.activeTrades,
        "Open shipments": cp.openShipments,
        "On-time %": cp.onTimeDeliveryPct,
        "Avg lead time (days)": cp.type === "SELLER" ? cp.avgLeadTimeDays : "",
        Commodities: cp.commoditiesSupplied.join(", "),
        "Last delivery":
          cp.lastDelivery instanceof Date
            ? cp.lastDelivery.toISOString().slice(0, 10)
            : cp.lastDelivery
              ? String(cp.lastDelivery).slice(0, 10)
              : "",
      })),
      "Counterparties",
      `counterparties-${stamp}.xlsx`,
    );
  }

  return (
    <div className="kastros-desk-page">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Supplier & Buyer Network</h1>
        <p className="text-sm text-subtle">
          Counterparty performance — lead times, delivery reliability, and active supply contracts.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Total counterparties", value: counterparties?.length ?? 0 },
          { label: "Active suppliers", value: sellers.length },
          { label: "Avg on-time delivery", value: formatPct(avgOtd) },
          { label: "Open inbound shipments", value: sellers.reduce((a, c) => a + c.openShipments, 0) },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5">
            <div className="text-xs uppercase tracking-wide text-subtle">{t.label}</div>
            <div className="mt-1 text-lg font-medium text-foreground">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {(["ALL", "SELLER", "BUYER"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md border px-3 py-1 text-xs ${
                filter === f
                  ? "border-success bg-success/10 text-success"
                  : "border-kastros-border text-muted-foreground hover:bg-foreground/5"
              }`}
            >
              {f === "SELLER" ? "Suppliers" : f === "BUYER" ? "Buyers" : "All"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={exportCounterparties}
          disabled={!counterparties?.length}
          className="inline-flex items-center gap-1.5 rounded-md border border-kastros-border px-3 py-1.5 text-xs text-foreground hover:bg-foreground/5 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          Download Excel
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="min-h-0 flex-1 overflow-auto text-sm">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-subtle">
              <tr>
                {[
                  "Code",
                  "Name",
                  "Type",
                  "Country",
                  "Credit limit",
                  "Active trades",
                  "Open shipments",
                  "On-time %",
                  "Avg lead time",
                  "Commodities",
                  "Last delivery",
                ].map((h) => (
                  <th key={h} className="border-b border-kastros-border px-2 py-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {counterparties?.map((cp) => (
                <tr key={cp.id} className="border-b border-kastros-border/60 hover:bg-foreground/[0.02]">
                  <td className="px-2 py-2 font-mono text-xs text-success">{cp.code}</td>
                  <td className="px-2 py-2 text-foreground">{cp.name}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        cp.type === "SELLER"
                          ? "bg-backgroundlue-500/20 text-blue-400"
                          : cp.type === "BUYER"
                            ? "bg-purple-500/20 text-purple-400"
                            : "bg-zinc-500/20 text-muted-foreground"
                      }`}
                    >
                      {COUNTERPARTY_TYPE_LABELS[cp.type] ?? cp.type}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{cp.country}</td>
                  <td className="px-2 py-2 data-grid">{formatCurrency(cp.creditLimit)}</td>
                  <td className="px-2 py-2 text-center">{cp.activeTrades}</td>
                  <td className="px-2 py-2 text-center">{cp.openShipments}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`data-grid ${
                        cp.onTimeDeliveryPct < 0.85
                          ? "text-red-400"
                          : cp.onTimeDeliveryPct >= 0.95
                            ? "text-success"
                            : "text-muted-foreground"
                      }`}
                    >
                      {formatPct(cp.onTimeDeliveryPct)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {cp.type === "SELLER" ? `${cp.avgLeadTimeDays} days` : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {cp.commoditiesSupplied.length > 0
                        ? cp.commoditiesSupplied.map((c) => (
                            <span key={c} className="rounded bg-kastros-border px-1.5 py-0.5 text-xs text-subtle">
                              {c}
                            </span>
                          ))
                        : "—"}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs text-subtle">
                    {cp.lastDelivery instanceof Date
                      ? cp.lastDelivery.toISOString().slice(0, 10)
                      : String(cp.lastDelivery).slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

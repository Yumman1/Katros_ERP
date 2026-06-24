"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatPct } from "@/lib/formatters/numbers";
import { useState } from "react";

type Filter = "ALL" | "SELLER" | "BUYER";

export default function SuppliersPage() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const { data: counterparties, isLoading } = trpc.supplyChain.counterparties.useQuery({
    type: filter === "ALL" ? undefined : filter,
  });

  if (isLoading) {
    return <div className="animate-pulse text-zinc-500">Loading supplier network…</div>;
  }

  const sellers = counterparties?.filter((c) => c.type === "SELLER") ?? [];
  const avgOtd =
    sellers.length > 0 ? sellers.reduce((a, c) => a + c.onTimeDeliveryPct, 0) / sellers.length : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Supplier & Buyer Network</h1>
        <p className="text-sm text-zinc-500">
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
            <div className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</div>
            <div className="mt-1 text-lg font-medium text-white">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {(["ALL", "SELLER", "BUYER"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-md border px-3 py-1 text-xs ${
              filter === f
                ? "border-kastros-green bg-kastros-green/10 text-kastros-green"
                : "border-kastros-border text-zinc-400 hover:bg-white/5"
            }`}
          >
            {f === "SELLER" ? "Suppliers" : f === "BUYER" ? "Buyers" : "All"}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="max-h-[520px] overflow-auto text-sm">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
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
                <tr key={cp.id} className="border-b border-kastros-border/60 hover:bg-white/[0.02]">
                  <td className="px-2 py-2 font-mono text-xs text-kastros-green">{cp.code}</td>
                  <td className="px-2 py-2 text-white">{cp.name}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        cp.type === "SELLER" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"
                      }`}
                    >
                      {cp.type}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-zinc-400">{cp.country}</td>
                  <td className="px-2 py-2 data-grid">{formatCurrency(cp.creditLimit)}</td>
                  <td className="px-2 py-2 text-center">{cp.activeTrades}</td>
                  <td className="px-2 py-2 text-center">{cp.openShipments}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`data-grid ${
                        cp.onTimeDeliveryPct < 0.85
                          ? "text-red-400"
                          : cp.onTimeDeliveryPct >= 0.95
                            ? "text-kastros-green"
                            : "text-zinc-300"
                      }`}
                    >
                      {formatPct(cp.onTimeDeliveryPct)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-zinc-400">
                    {cp.type === "SELLER" ? `${cp.avgLeadTimeDays} days` : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {cp.commoditiesSupplied.length > 0
                        ? cp.commoditiesSupplied.map((c) => (
                            <span key={c} className="rounded bg-kastros-border px-1.5 py-0.5 text-xs text-zinc-500">
                              {c}
                            </span>
                          ))
                        : "—"}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs text-zinc-500">
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

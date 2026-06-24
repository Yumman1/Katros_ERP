"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQty } from "@/lib/formatters/numbers";
import type { ShipmentListRow } from "@/server/routers/shipments";
import { useState } from "react";

const STATUSES = ["ALL", "PLANNED", "LOADING", "IN_TRANSIT", "AT_PORT", "DELIVERED", "DELAYED"] as const;

const statusStyle: Record<string, string> = {
  PLANNED: "bg-zinc-500/20 text-zinc-400",
  LOADING: "bg-purple-500/20 text-purple-400",
  IN_TRANSIT: "bg-blue-500/20 text-blue-400",
  AT_PORT: "bg-cyan-500/20 text-cyan-400",
  DELIVERED: "bg-kastros-green/20 text-kastros-green",
  DELAYED: "bg-red-500/20 text-red-400",
  CANCELLED: "bg-zinc-600/20 text-zinc-500",
};

export default function ShipmentsPage() {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("ALL");
  const { data: summary } = trpc.shipments.summary.useQuery();
  const { data: shipments } = trpc.shipments.list.useQuery({
    status: statusFilter === "ALL" ? undefined : statusFilter,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Logistics & Shipments</h1>
        <p className="text-sm text-zinc-500">
          Vessel, rail, and road movements linked to trades and warehouse receipts.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Total shipments", value: summary?.total ?? "—" },
          { label: "In pipeline", value: summary?.inTransit ?? "—" },
          { label: "Delayed", value: summary?.delayed ?? "—", warn: (summary?.delayed ?? 0) > 0 },
          { label: "Delivered (30d)", value: summary?.delivered30d ?? "—" },
          { label: "Qty in pipeline", value: summary ? `${formatQty(summary.totalQtyInPipeline)} MT` : "—" },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</div>
            <div className={`mt-1 text-lg font-medium ${"warn" in t && t.warn ? "text-red-400" : "text-white"}`}>
              {t.value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-md border px-3 py-1 text-xs ${
              statusFilter === s
                ? "border-kastros-green bg-kastros-green/10 text-kastros-green"
                : "border-kastros-border text-zinc-400 hover:bg-white/5"
            }`}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="max-h-[520px] overflow-auto text-sm">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
              <tr>
                {[
                  "Shipment ref",
                  "B/L",
                  "Trade",
                  "Commodity",
                  "Counterparty",
                  "Qty (MT)",
                  "Carrier / Vessel",
                  "Origin",
                  "Destination",
                  "Location",
                  "Shipped",
                  "ETA",
                  "Status",
                ].map((h) => (
                  <th key={h} className="border-b border-kastros-border px-2 py-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(shipments as ShipmentListRow[] | undefined)?.map((s) => (
                <tr key={s.id} className="border-b border-kastros-border/60 hover:bg-white/[0.02]">
                  <td className="px-2 py-2 font-mono text-xs text-white">{s.reference}</td>
                  <td className="px-2 py-2 font-mono text-xs text-zinc-500">{s.blRef ?? "—"}</td>
                  <td className="px-2 py-2 text-xs">{s.tradeRef ?? "—"}</td>
                  <td className="px-2 py-2">{s.commodity}</td>
                  <td className="px-2 py-2 text-xs text-zinc-400">{s.counterparty}</td>
                  <td className="px-2 py-2 data-grid">{formatQty(s.quantity)}</td>
                  <td className="px-2 py-2 text-xs">
                    <div>{s.carrier}</div>
                    <div className="text-zinc-500">{s.vesselName}</div>
                  </td>
                  <td className="px-2 py-2 text-xs text-zinc-400 max-w-[120px]">{s.originName}</td>
                  <td className="px-2 py-2 text-xs text-zinc-400 max-w-[120px]">{s.destName}</td>
                  <td className="px-2 py-2 text-xs">{s.location.name}</td>
                  <td className="px-2 py-2 text-xs text-zinc-500">
                    {s.shippedAt instanceof Date ? s.shippedAt.toISOString().slice(0, 10) : String(s.shippedAt).slice(0, 10)}
                  </td>
                  <td className="px-2 py-2 text-xs text-zinc-500">
                    {s.eta instanceof Date ? s.eta.toISOString().slice(0, 10) : String(s.eta).slice(0, 10)}
                  </td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${statusStyle[s.status] ?? ""}`}>
                      {s.status.replace("_", " ")}
                    </span>
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

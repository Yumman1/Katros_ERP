"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQty } from "@/lib/formatters/numbers";
import type { ShipmentListRow } from "@/server/routers/shipments";
import { useState } from "react";

const STATUSES = ["ALL", "PLANNED", "LOADING", "IN_TRANSIT", "AT_PORT", "DELIVERED", "DELAYED"] as const;

const statusStyle: Record<string, string> = {
  PLANNED: "bg-zinc-500/20 text-muted-foreground",
  LOADING: "bg-purple-500/20 text-purple-400",
  IN_TRANSIT: "bg-backgroundlue-500/20 text-blue-400",
  AT_PORT: "bg-cyan-500/20 text-cyan-400",
  DELIVERED: "bg-success/20 text-success",
  DELAYED: "bg-red-500/20 text-red-400",
  CANCELLED: "bg-zinc-600/20 text-subtle",
};

export default function ShipmentsPage() {
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("ALL");
  const { data: summary } = trpc.shipments.summary.useQuery();
  const { data: shipments } = trpc.shipments.list.useQuery({
    status: statusFilter === "ALL" ? undefined : statusFilter,
  });

  return (
    <div className="kastros-desk-page">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Logistics & Shipments</h1>
        <p className="text-sm text-subtle">
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
            <div className="text-xs uppercase tracking-wide text-subtle">{t.label}</div>
            <div className={`mt-1 text-lg font-medium ${"warn" in t && t.warn ? "text-red-400" : "text-foreground"}`}>
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
                ? "border-success bg-success/10 text-success"
                : "border-kastros-border text-muted-foreground hover:bg-foreground/5"
            }`}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
        <div className="min-h-0 flex-1 overflow-auto text-sm">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-subtle">
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
                <tr key={s.id} className="border-b border-kastros-border/60 hover:bg-foreground/[0.02]">
                  <td className="px-2 py-2 font-mono text-xs text-foreground">{s.reference}</td>
                  <td className="px-2 py-2 font-mono text-xs text-subtle">{s.blRef ?? "—"}</td>
                  <td className="px-2 py-2 text-xs">{s.tradeRef ?? "—"}</td>
                  <td className="px-2 py-2">{s.commodity}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">{s.counterparty}</td>
                  <td className="px-2 py-2 data-grid">{formatQty(s.quantity)}</td>
                  <td className="px-2 py-2 text-xs">
                    <div>{s.carrier}</div>
                    <div className="text-subtle">{s.vesselName}</div>
                  </td>
                  <td className="px-2 py-2 text-xs text-muted-foreground max-w-[120px]">{s.originName}</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground max-w-[120px]">{s.destName}</td>
                  <td className="px-2 py-2 text-xs">{s.location.name}</td>
                  <td className="px-2 py-2 text-xs text-subtle">
                    {s.shippedAt instanceof Date ? s.shippedAt.toISOString().slice(0, 10) : String(s.shippedAt).slice(0, 10)}
                  </td>
                  <td className="px-2 py-2 text-xs text-subtle">
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

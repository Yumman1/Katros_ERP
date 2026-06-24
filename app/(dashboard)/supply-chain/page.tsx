"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatPct, formatQty } from "@/lib/formatters/numbers";
import type { ShipmentListRow } from "@/server/routers/shipments";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const severityColor = {
  high: "text-red-400 border-red-500/30 bg-red-500/10",
  medium: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  low: "text-zinc-400 border-zinc-500/30 bg-zinc-500/10",
};

export default function SupplyChainPage() {
  const { data: overview, isLoading } = trpc.supplyChain.overview.useQuery();
  const { data: locations } = trpc.supplyChain.locations.useQuery();
  const { data: posInv } = trpc.supplyChain.positionVsInventory.useQuery();
  const { data: shipments } = trpc.shipments.list.useQuery({});

  if (isLoading || !overview) {
    return <div className="animate-pulse text-zinc-500">Loading supply chain operations…</div>;
  }

  const { kpis, pipeline, alerts } = overview;
  const utilChart = (locations ?? []).map((l) => ({
    name: l.name.split(" ")[0],
    fullName: l.name,
    utilization: Math.round(l.utilization * 100),
    onHand: l.onHand,
    capacity: l.capacityMt,
  }));

  const activeShipments = ((shipments ?? []) as unknown as ShipmentListRow[]).filter(
    (s) => s.status !== "DELIVERED" && s.status !== "CANCELLED",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Supply Chain Operations</h1>
        <p className="text-sm text-zinc-500">
          End-to-end physical flow — procurement, warehousing, logistics, and delivery.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {[
          { label: "Physical stock", value: `${formatQty(kpis.totalOnHand)} MT` },
          { label: "Available to sell", value: `${formatQty(kpis.availableToSell)} MT` },
          { label: "Reserved / allocated", value: `${formatQty(kpis.totalReserved)} MT` },
          { label: "In transit", value: `${formatQty(kpis.totalTransit)} MT` },
          { label: "Inventory value", value: formatCurrency(kpis.totalValue) },
          { label: "Fill rate", value: formatPct(kpis.fillRate) },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</div>
            <div className="mt-1 data-grid text-base font-medium text-white">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Avg dwell time", value: `${kpis.avgDwellDays} days` },
          { label: "Shipments in pipeline", value: kpis.shipmentsInPipeline.toString() },
          { label: "Delayed shipments", value: kpis.delayedShipments.toString(), warn: kpis.delayedShipments > 0 },
          { label: "Open purchase trades", value: `${kpis.openPurchaseTrades} (${formatQty(kpis.awaitingReceipt)} MT awaiting receipt)` },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2.5">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</div>
            <div className={`mt-1 text-sm ${"warn" in t && t.warn ? "text-red-400" : "text-white"}`}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
        <h2 className="text-sm font-medium text-zinc-300">Physical flow pipeline</h2>
        <p className="mt-1 text-xs text-zinc-500">From supplier confirmation through to customer delivery</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {pipeline.map((stage, i) => (
            <div key={stage.stage} className="flex items-center gap-2">
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  stage.status === "complete"
                    ? "border-kastros-green/30 bg-kastros-green/10 text-kastros-green"
                    : "border-kastros-border bg-kastros-bg text-zinc-300"
                }`}
              >
                <div className="font-medium">{stage.stage}</div>
                <div className="mt-0.5 text-zinc-500">
                  {stage.count} items · {formatQty(stage.qtyMt)} MT
                </div>
              </div>
              {i < pipeline.length - 1 && <span className="text-zinc-600">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-lg border border-kastros-border bg-kastros-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-300">Location utilization</h2>
            <Link href="/locations" className="text-xs text-kastros-green hover:underline">
              View all locations →
            </Link>
          </div>
          <div className="mt-3 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={utilChart} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
                <XAxis type="number" domain={[0, 100]} stroke="#9ca3af" unit="%" />
                <YAxis type="category" dataKey="name" stroke="#9ca3af" width={70} />
                <Tooltip
                  contentStyle={{ background: "#1a1f2e", border: "1px solid #2a3142" }}
                  formatter={(v) => [`${v ?? 0}%`, "Utilization"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                />
                <Bar dataKey="utilization" name="Utilization %" radius={[0, 4, 4, 0]}>
                  {utilChart.map((entry) => (
                    <Cell
                      key={entry.fullName}
                      fill={entry.utilization > 80 ? "#ff4d4f" : entry.utilization > 60 ? "#f59e0b" : "#00C896"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-kastros-border bg-kastros-card p-4">
          <h2 className="text-sm font-medium text-zinc-300">Operational alerts</h2>
          <div className="mt-3 space-y-2">
            {alerts.map((a) => (
              <div
                key={a.id}
                className={`rounded-md border px-3 py-2 text-xs ${severityColor[a.severity]}`}
              >
                {a.message}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
          <div className="flex items-center justify-between border-b border-kastros-border px-3 py-2">
            <span className="text-sm text-zinc-300">Active shipments</span>
            <Link href="/shipments" className="text-xs text-kastros-green hover:underline">
              Full logistics view →
            </Link>
          </div>
          <div className="max-h-72 overflow-auto text-sm">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
                <tr>
                  {["Ref", "Commodity", "Qty", "Route", "Status", "ETA"].map((h) => (
                    <th key={h} className="border-b border-kastros-border px-2 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeShipments.map((s) => (
                  <tr key={s.id} className="border-b border-kastros-border/60">
                    <td className="px-2 py-1.5 font-mono text-xs">{s.reference}</td>
                    <td className="px-2 py-1.5">{s.commodity}</td>
                    <td className="px-2 py-1.5 data-grid">{formatQty(s.quantity)}</td>
                    <td className="px-2 py-1.5 text-xs text-zinc-500">
                      {s.originName?.split(",")[0]} → {s.destName?.split(",")[0]}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          s.status === "DELAYED"
                            ? "bg-red-500/20 text-red-400"
                            : s.status === "IN_TRANSIT" || s.status === "AT_PORT"
                              ? "bg-blue-500/20 text-blue-400"
                              : "bg-zinc-500/20 text-zinc-400"
                        }`}
                      >
                        {s.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-zinc-500">
                      {s.eta instanceof Date ? s.eta.toISOString().slice(0, 10) : String(s.eta).slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
          <div className="flex items-center justify-between border-b border-kastros-border px-3 py-2">
            <span className="text-sm text-zinc-300">Position vs physical inventory</span>
            <Link href="/reconciliation" className="text-xs text-kastros-green hover:underline">
              Reconciliation →
            </Link>
          </div>
          <div className="max-h-72 overflow-auto text-sm">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
                <tr>
                  {["Commodity", "Paper position", "Physical", "Available", "Variance", "Status"].map((h) => (
                    <th key={h} className="border-b border-kastros-border px-2 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {posInv?.map((r) => (
                  <tr key={r.code} className="border-b border-kastros-border/60">
                    <td className="px-2 py-1.5">{r.code}</td>
                    <td className="px-2 py-1.5 data-grid">{formatQty(r.positionNet)}</td>
                    <td className="px-2 py-1.5 data-grid">{formatQty(r.physicalOnHand)}</td>
                    <td className="px-2 py-1.5 data-grid">{formatQty(r.physicalAvailable)}</td>
                    <td className={`px-2 py-1.5 data-grid ${r.variance !== 0 ? "text-amber-400" : ""}`}>
                      {formatQty(r.variance)}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`text-xs ${
                          r.status === "MATCHED"
                            ? "text-kastros-green"
                            : r.status === "BREAK"
                              ? "text-red-400"
                              : "text-amber-400"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/inventory" className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5">
          Inventory lots & movements
        </Link>
        <Link href="/shipments" className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5">
          Logistics & shipments
        </Link>
        <Link href="/locations" className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5">
          Warehouse network
        </Link>
        <Link href="/suppliers" className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5">
          Supplier performance
        </Link>
        <Link href="/traceability" className="rounded-md border border-kastros-border px-3 py-1.5 text-sm text-kastros-green hover:bg-white/5">
          Batch traceability
        </Link>
      </div>
    </div>
  );
}

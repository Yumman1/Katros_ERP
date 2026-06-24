"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useState } from "react";
import Link from "next/link";
import { InventoryStatus } from "@prisma/client";

type Tab = "stock" | "movements" | "aging";

const STATUS_OPTIONS: { value: InventoryStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: InventoryStatus.IN_STOCK, label: "In stock" },
  { value: InventoryStatus.RESERVED, label: "Reserved" },
  { value: InventoryStatus.TRANSIT, label: "In transit" },
  { value: InventoryStatus.DELIVERED, label: "Delivered" },
];

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>("stock");
  const [statusFilter, setStatusFilter] = useState<InventoryStatus | "ALL">("ALL");
  const [selectedLot, setSelectedLot] = useState<string | null>(null);

  const list = trpc.inventory.list.useQuery({
    status: statusFilter === "ALL" ? undefined : statusFilter,
  });
  const mov = trpc.inventory.movements.useQuery({
    inventoryId: selectedLot ?? undefined,
  });
  const summ = trpc.inventory.summary.useQuery();
  const aging = trpc.inventory.aging.useQuery();
  const locations = trpc.supplyChain.locations.useQuery();

  const chart = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of list.data ?? []) {
      const k = row.location.name;
      m.set(k, (m.get(k) ?? 0) + Number(row.quantity));
    }
    return Array.from(m.entries()).map(([name, qty]) => ({ name: name.split(" ")[0], qty }));
  }, [list.data]);

  const agingChart = useMemo(() => {
    const buckets = ["0-30d", "31-60d", "61-90d", "90d+"];
    const counts = buckets.map((b) => ({
      bucket: b,
      qty: (aging.data ?? []).filter((a) => a.agingBucket === b).reduce((s, a) => s + a.quantity, 0),
    }));
    return counts;
  }, [aging.data]);

  const totals = useMemo(() => {
    const rows = list.data ?? [];
    return {
      lots: rows.length,
      onHand: rows.reduce((a, r) => a + Number(r.quantity), 0),
      reserved: rows.reduce((a, r) => a + Number(r.reservedQty), 0),
      transit: rows.reduce((a, r) => a + Number(r.inTransitQty), 0),
      value: rows.reduce((a, r) => a + Number(r.totalValue), 0),
    };
  }, [list.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Inventory Management</h1>
          <p className="text-sm text-zinc-500">
            Lot-level stock, movements, aging, and availability across warehouses and ports.
          </p>
        </div>
        <Link
          href="/supply-chain"
          className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-kastros-green hover:bg-white/5"
        >
          Supply chain overview →
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Lots", value: totals.lots.toString() },
          { label: "On hand", value: `${formatQty(totals.onHand)} MT` },
          { label: "Available", value: `${formatQty(totals.onHand - totals.reserved)} MT` },
          { label: "Reserved", value: `${formatQty(totals.reserved)} MT` },
          { label: "Total value", value: formatCurrency(totals.value) },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border border-kastros-border bg-kastros-card px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{t.label}</div>
            <div className="mt-0.5 data-grid text-base font-medium text-white">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {summ.data?.map((s) => (
          <div key={s.code} className="rounded-lg border border-kastros-border bg-kastros-card p-3 text-sm">
            <div className="font-medium text-white">{s.code}</div>
            <div className="mt-1 space-y-0.5 text-xs text-zinc-400">
              <div className="flex justify-between">
                <span>On hand</span>
                <span className="data-grid">{formatQty(s.onHand)}</span>
              </div>
              <div className="flex justify-between">
                <span>Reserved</span>
                <span className="data-grid">{formatQty(s.reserved)}</span>
              </div>
              <div className="flex justify-between">
                <span>In transit</span>
                <span className="data-grid">{formatQty(s.transit)}</span>
              </div>
              <div className="flex justify-between text-kastros-green">
                <span>Value</span>
                <span className="data-grid">{formatCurrency(s.value)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 rounded-lg border border-kastros-border bg-kastros-card p-3">
          <div className="text-sm text-zinc-300">Quantity by location</div>
          <ResponsiveContainer width="100%" height="88%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ background: "#1a1f2e", border: "1px solid #2a3142" }} />
              <Bar dataKey="qty" fill="#00C896" name="MT" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="h-48 rounded-lg border border-kastros-border bg-kastros-card p-3">
          <div className="text-sm text-zinc-300">Stock aging distribution</div>
          <ResponsiveContainer width="100%" height="88%">
            <BarChart data={agingChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
              <XAxis dataKey="bucket" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ background: "#1a1f2e", border: "1px solid #2a3142" }} />
              <Bar dataKey="qty" fill="#6366f1" name="MT" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-kastros-border bg-kastros-card p-1">
          {(["stock", "movements", "aging"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 text-xs capitalize ${
                tab === t ? "bg-kastros-green/20 text-kastros-green" : "text-zinc-400 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "stock" && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InventoryStatus | "ALL")}
            className="rounded-md border border-kastros-border bg-kastros-bg px-2 py-1 text-xs text-zinc-300"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {selectedLot && tab === "movements" && (
          <button
            type="button"
            onClick={() => setSelectedLot(null)}
            className="text-xs text-zinc-500 hover:text-white"
          >
            Clear lot filter ×
          </button>
        )}
      </div>

      {tab === "stock" && (
        <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
          <div className="border-b border-kastros-border px-3 py-2 text-sm text-zinc-300">
            Stock lots — click a row to view movements
          </div>
          <div className="max-h-[420px] overflow-auto text-sm">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
                <tr>
                  {[
                    "Lot ref",
                    "Commodity",
                    "Location",
                    "Qty (MT)",
                    "Available",
                    "Reserved",
                    "In transit",
                    "Grade",
                    "Arrival",
                    "Expiry",
                    "Unit price",
                    "Value",
                    "Status",
                  ].map((h) => (
                    <th key={h} className="border-b border-kastros-border px-2 py-2 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data?.map((r) => {
                  const available = Number(r.quantity) - Number(r.reservedQty);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => {
                        setSelectedLot(r.id);
                        setTab("movements");
                      }}
                      className="cursor-pointer border-b border-kastros-border/60 hover:bg-white/[0.03]"
                    >
                      <td className="px-2 py-1.5 font-mono text-xs text-kastros-green">{r.warehouseRef ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.commodity.code}</td>
                      <td className="px-2 py-1.5 text-zinc-400">{r.location.name}</td>
                      <td className="px-2 py-1.5 data-grid">{formatQty(Number(r.quantity))}</td>
                      <td className="px-2 py-1.5 data-grid text-kastros-green">{formatQty(available)}</td>
                      <td className="px-2 py-1.5 data-grid text-amber-400/80">{formatQty(Number(r.reservedQty))}</td>
                      <td className="px-2 py-1.5 data-grid text-blue-400/80">{formatQty(Number(r.inTransitQty))}</td>
                      <td className="px-2 py-1.5 text-zinc-500">{r.qualityGrade ?? "—"}</td>
                      <td className="px-2 py-1.5 text-xs text-zinc-500">
                        {r.arrivalDate ? r.arrivalDate.toISOString().slice(0, 10) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-zinc-500">
                        {r.expiryDate ? r.expiryDate.toISOString().slice(0, 10) : "—"}
                      </td>
                      <td className="px-2 py-1.5 data-grid">{formatCurrency(Number(r.valuationPrice))}</td>
                      <td className="px-2 py-1.5 data-grid">{formatCurrency(Number(r.totalValue))}</td>
                      <td className="px-2 py-1.5">
                        <span className="rounded bg-kastros-border px-1.5 py-0.5 text-xs">{r.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "movements" && (
        <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
          <div className="border-b border-kastros-border px-3 py-2 text-sm text-zinc-300">
            Inventory movements {selectedLot ? `(filtered to lot)` : "(all lots)"}
          </div>
          <div className="max-h-[420px] overflow-auto text-sm">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
                <tr>
                  {["Date", "Type", "Qty (MT)", "Reference", "Notes", "Lot", "Location"].map((h) => (
                    <th key={h} className="border-b border-kastros-border px-2 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mov.data?.map((mv) => (
                  <tr key={mv.id} className="border-b border-kastros-border/60">
                    <td className="px-2 py-1.5">{mv.movementDate.toISOString().slice(0, 10)}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          mv.movementType === "IN"
                            ? "bg-kastros-green/20 text-kastros-green"
                            : mv.movementType === "OUT"
                              ? "bg-red-500/20 text-red-400"
                              : mv.movementType === "TRANSFER"
                                ? "bg-blue-500/20 text-blue-400"
                                : "bg-amber-500/20 text-amber-400"
                        }`}
                      >
                        {mv.movementType}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 data-grid">{formatQty(Number(mv.quantity))}</td>
                    <td className="px-2 py-1.5 font-mono text-xs text-zinc-500">{mv.reference ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs text-zinc-500 max-w-[200px]">{mv.notes ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{mv.inventory.commodity.code}</td>
                    <td className="px-2 py-1.5 text-xs text-zinc-500">{mv.inventory.location.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "aging" && (
        <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
          <div className="border-b border-kastros-border px-3 py-2 text-sm text-zinc-300">
            Stock aging — dwell time and expiry tracking
          </div>
          <div className="max-h-[420px] overflow-auto text-sm">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-kastros-card text-left text-xs uppercase text-zinc-500">
                <tr>
                  {[
                    "Lot ref",
                    "Commodity",
                    "Location",
                    "Qty",
                    "Available",
                    "Days in storage",
                    "Aging bucket",
                    "Grade",
                    "Expiry",
                  ].map((h) => (
                    <th key={h} className="border-b border-kastros-border px-2 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aging.data?.map((a) => (
                  <tr key={a.id} className="border-b border-kastros-border/60">
                    <td className="px-2 py-1.5 font-mono text-xs">{a.warehouseRef ?? "—"}</td>
                    <td className="px-2 py-1.5">{a.commodity}</td>
                    <td className="px-2 py-1.5 text-zinc-400">{a.location}</td>
                    <td className="px-2 py-1.5 data-grid">{formatQty(a.quantity)}</td>
                    <td className="px-2 py-1.5 data-grid">{formatQty(a.available)}</td>
                    <td className="px-2 py-1.5 data-grid">{a.daysInStorage}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          a.agingBucket === "90d+"
                            ? "bg-red-500/20 text-red-400"
                            : a.agingBucket === "61-90d"
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-zinc-500/20 text-zinc-400"
                        }`}
                      >
                        {a.agingBucket}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-zinc-500">{a.qualityGrade ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs text-zinc-500">
                      {a.expiryDate
                        ? a.expiryDate instanceof Date
                          ? a.expiryDate.toISOString().slice(0, 10)
                          : String(a.expiryDate).slice(0, 10)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {locations.data && (
        <div className="rounded-lg border border-kastros-border bg-kastros-card p-3 text-xs text-zinc-500">
          Network: {locations.data.length} sites ·{" "}
          {formatQty(locations.data.reduce((a, l) => a + l.onHand, 0))} MT on hand ·{" "}
          {formatQty(locations.data.reduce((a, l) => a + l.availableCapacity, 0))} MT spare capacity
        </div>
      )}
    </div>
  );
}

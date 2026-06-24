"use client";

import { trpc } from "@/lib/trpc/client";
import { CheckCircle2, MapPin, Plus, Warehouse } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function WarehouseLocationsPage() {
  const utils = trpc.useUtils();
  const { data: locations, isLoading } = trpc.execution.warehouseLocations.useQuery();
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState<string | null>(null);
  const addWarehouse = trpc.execution.addWarehouseLocation.useMutation({
    onSuccess: (row) => {
      setName("");
      setSavedName(row.name);
      void utils.execution.warehouseLocations.invalidate();
      void utils.trader.referenceData.invalidate();
    },
  });

  const sorted = useMemo(
    () => [...(locations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [locations],
  );

  function submit() {
    const n = name.trim();
    if (!n) return;
    setSavedName(null);
    addWarehouse.mutate({ name: n });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
            <Link href="/execution" className="hover:text-white">Desk</Link>
            <span>/</span>
            <span style={{ color: "#a1a1aa" }}>Warehouse Locations</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white">Warehouse Locations</h1>
          <p className="mt-1 text-sm" style={{ color: "#71717a" }}>
            Shared location master used by trader booking, execution inventory, and warehouse gatepasses.
          </p>
        </div>
        <Link
          href="/execution/inventory"
          className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white"
          style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
        >
          <Warehouse className="h-4 w-4" />
          Inventory
        </Link>
      </div>

      <section className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-sm font-semibold text-white">Add Warehouse</h2>
          <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
            New locations appear immediately in trade booking location fields and gatepass warehouse pickers.
          </p>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSavedName(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. Faisalabad Warehouse"
            className="rounded-xl px-3 py-2.5 text-sm text-white outline-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || addWarehouse.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#f59e0b,#fbbf24)" }}
          >
            <Plus className="h-4 w-4" />
            {addWarehouse.isPending ? "Adding..." : "Add location"}
          </button>
        </div>
        {savedName && (
          <div className="mx-5 mb-5 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {savedName} added to shared warehouse locations.
          </div>
        )}
        {addWarehouse.error && (
          <div className="mx-5 mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {addWarehouse.error.message}
          </div>
        )}
      </section>

      <section className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-sm font-semibold text-white">Location Master</h2>
          <span className="text-xs" style={{ color: "#71717a" }}>{sorted.length} locations</span>
        </div>
        {isLoading ? (
          <div className="px-5 py-8 text-sm text-zinc-500">Loading locations...</div>
        ) : (
          <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((loc) => (
              <div
                key={loc.id}
                className="flex items-center gap-3 rounded-xl border px-3 py-3"
                style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                  <MapPin className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{loc.name}</div>
                  <div className="font-mono text-[10px] text-zinc-600">{loc.id}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

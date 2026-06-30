"use client";

import {
  aggregateWarehouseStock,
  warehouseUtilizationSummary,
} from "@/lib/warehouse-utilization";
import { trpc } from "@/lib/trpc/client";
import { CheckCircle2, MapPin, Pencil, Plus, Warehouse } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type FormState = {
  name: string;
  code: string;
  lsp: string;
  address: string;
  city: string;
  province: string;
  capacitySqFt: string;
  costPerSqFt: string;
  balesDivisionSqFt: string;
  grainDivisionSqFt: string;
};

const emptyForm = (): FormState => ({
  name: "",
  code: "",
  lsp: "",
  address: "",
  city: "",
  province: "",
  capacitySqFt: "",
  costPerSqFt: "",
  balesDivisionSqFt: "4.5",
  grainDivisionSqFt: "7",
});

function parseForm(form: FormState) {
  return {
    name: form.name.trim(),
    code: form.code.trim() || undefined,
    lsp: form.lsp.trim() || undefined,
    address: form.address.trim() || undefined,
    city: form.city.trim() || undefined,
    province: form.province.trim() || undefined,
    capacitySqFt: form.capacitySqFt ? Number(form.capacitySqFt) : undefined,
    costPerSqFt: form.costPerSqFt ? Number(form.costPerSqFt) : undefined,
    balesDivisionSqFt: form.balesDivisionSqFt ? Number(form.balesDivisionSqFt) : undefined,
    grainDivisionSqFt: form.grainDivisionSqFt ? Number(form.grainDivisionSqFt) : undefined,
  };
}

export default function WarehouseLocationsPage() {
  const utils = trpc.useUtils();
  const { data: locations, isLoading } = trpc.execution.warehouseLocations.useQuery();
  const { data: inbound } = trpc.execution.inboundReceipts.useQuery({});
  const { data: outbound } = trpc.execution.outboundDispatches.useQuery({});

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  const addWarehouse = trpc.execution.addWarehouseLocation.useMutation({
    onSuccess: (row) => {
      setForm(emptyForm());
      setSavedName(row.name);
      void utils.execution.warehouseLocations.invalidate();
      void utils.trader.referenceData.invalidate();
    },
  });

  const updateWarehouse = trpc.execution.updateWarehouseLocation.useMutation({
    onSuccess: (row) => {
      setEditingId(null);
      setForm(emptyForm());
      setSavedName(row.name);
      void utils.execution.warehouseLocations.invalidate();
      void utils.trader.referenceData.invalidate();
    },
  });

  const stockByWarehouse = useMemo(() => {
    const map = new Map<string, { commodityCode: string; quantityUnit: string; netQty: number }[]>();
    for (const r of inbound ?? []) {
      const rows = map.get(r.warehouseName) ?? [];
      rows.push({ commodityCode: "WHT", quantityUnit: "MT", netQty: r.allocatedQtyMt });
      map.set(r.warehouseName, rows);
    }
    for (const d of outbound ?? []) {
      if (d.status !== "RELEASED") continue;
      const rows = map.get(d.warehouseName) ?? [];
      rows.push({ commodityCode: "WHT", quantityUnit: "MT", netQty: -d.allocatedQtyMt });
      map.set(d.warehouseName, rows);
    }
    return map;
  }, [inbound, outbound]);

  const sorted = useMemo(
    () => [...(locations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [locations],
  );

  function startEdit(loc: NonNullable<typeof locations>[number]) {
    setEditingId(loc.id);
    setSavedName(null);
    setForm({
      name: loc.name,
      code: loc.code ?? "",
      lsp: loc.lsp ?? "",
      address: loc.address ?? "",
      city: loc.city ?? "",
      province: loc.province ?? "",
      capacitySqFt: loc.capacitySqFt != null ? String(loc.capacitySqFt) : "",
      costPerSqFt: loc.costPerSqFt != null ? String(loc.costPerSqFt) : "",
      balesDivisionSqFt: loc.balesDivisionSqFt != null ? String(loc.balesDivisionSqFt) : "4.5",
      grainDivisionSqFt: loc.grainDivisionSqFt != null ? String(loc.grainDivisionSqFt) : "7",
    });
  }

  function submit() {
    const payload = parseForm(form);
    if (!payload.name) return;
    setSavedName(null);
    if (editingId) {
      updateWarehouse.mutate({ id: editingId, ...payload });
      return;
    }
    addWarehouse.mutate(payload);
  }

  const pending = addWarehouse.isPending || updateWarehouse.isPending;
  const error = addWarehouse.error ?? updateWarehouse.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
            <Link href="/execution" className="hover:text-white">Desk</Link>
            <span>/</span>
            <span style={{ color: "#a1a1aa" }}>Warehouses</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white">Warehouse Setup</h1>
          <p className="mt-1 text-sm" style={{ color: "#71717a" }}>
            Configure square-foot capacity and grain/bale conversion factors for utilization tracking.
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
          <h2 className="text-sm font-semibold text-white">
            {editingId ? "Edit Warehouse" : "Add Warehouse"}
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
            Grain and bales share one sq ft pool. Divisions convert each unit into floor space — more of one type leaves less room for the other.
          </p>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["name", "Warehouse name", "K001-Al Amin WH SWL"],
              ["code", "WH code", "K001"],
              ["lsp", "LSP", "Hellmann"],
              ["city", "Location", "Sahiwal"],
              ["province", "Province", "Punjab"],
              ["capacitySqFt", "Capacity (sq ft)", "38680"],
              ["costPerSqFt", "Cost per sq ft", "36"],
              ["balesDivisionSqFt", "Bales division (sq ft/bale)", "4.5"],
              ["grainDivisionSqFt", "Grain division (sq ft/MT)", "6.04"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="block text-xs text-zinc-500">
              {label}
              <input
                value={form[key]}
                onChange={(e) => {
                  setForm((s) => ({ ...s, [key]: e.target.value }));
                  setSavedName(null);
                }}
                placeholder={placeholder}
                className="mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              />
            </label>
          ))}
          <label className="block text-xs text-zinc-500 md:col-span-2 lg:col-span-3">
            Address
            <input
              value={form.address}
              onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))}
              placeholder="Full warehouse address"
              className="mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-white outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={submit}
            disabled={!form.name.trim() || pending}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#f59e0b,#fbbf24)" }}
          >
            {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {pending ? "Saving..." : editingId ? "Save changes" : "Add warehouse"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm());
              }}
              className="rounded-xl border px-4 py-2.5 text-sm text-zinc-400 hover:text-white"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              Cancel edit
            </button>
          )}
        </div>
        {savedName && (
          <div className="mx-5 mb-5 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {savedName} saved.
          </div>
        )}
        {error && (
          <div className="mx-5 mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error.message}
          </div>
        )}
      </section>

      <section className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-sm font-semibold text-white">Warehouse Master & Utilization</h2>
          <span className="text-xs" style={{ color: "#71717a" }}>{sorted.length} locations</span>
        </div>
        {isLoading ? (
          <div className="px-5 py-8 text-sm text-zinc-500">Loading locations...</div>
        ) : (
          <div className="grid gap-3 p-5 lg:grid-cols-2">
            {sorted.map((loc) => {
              const capSqFt = loc.capacitySqFt ?? 0;
              const balesDiv = loc.balesDivisionSqFt ?? 4.5;
              const grainDiv = loc.grainDivisionSqFt ?? 7;
              const capacity = { capacitySqFt: capSqFt, balesDivisionSqFt: balesDiv, grainDivisionSqFt: grainDiv };
              const stock = aggregateWarehouseStock(stockByWarehouse.get(loc.name) ?? []);
              const util = capSqFt > 0 ? warehouseUtilizationSummary(stock, capacity) : null;

              return (
                <div
                  key={loc.id}
                  className="rounded-xl border p-4"
                  style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                        <MapPin className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{loc.name}</div>
                        <div className="text-xs text-zinc-500">
                          {[loc.code, loc.city, loc.province].filter(Boolean).join(" · ") || loc.id}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(loc)}
                      className="rounded-lg border px-2 py-1 text-xs text-zinc-400 hover:text-white"
                      style={{ borderColor: "rgba(255,255,255,0.08)" }}
                    >
                      Edit
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <Stat label="Total sq ft" value={capSqFt ? capSqFt.toLocaleString() : "—"} />
                    <Stat
                      label="Utilization"
                      value={util ? `${(util.utilizationPct * 100).toFixed(1)}%` : "—"}
                    />
                    <Stat
                      label="Used sq ft"
                      value={util ? util.consumedSqFt.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    />
                    <Stat
                      label="Free sq ft"
                      value={util ? util.remainingSqFt.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    />
                    <Stat
                      label="Max if grain only"
                      value={util ? `${util.theoreticalMaxMt} MT` : "—"}
                    />
                    <Stat
                      label="Max if bales only"
                      value={util ? `${util.theoreticalMaxBales} bales` : "—"}
                    />
                    <Stat label="On hand (MT)" value={stock.stockMt.toFixed(1)} />
                    <Stat label="On hand (bales)" value={String(Math.round(stock.stockBales))} />
                  </div>

                  {util && (
                    <div className="mt-3">
                      <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(util.utilizationPct * 100, 100)}%`,
                            background:
                              util.utilizationPct > 0.9
                                ? "#f87171"
                                : util.utilizationPct > 0.75
                                  ? "#fbbf24"
                                  : "#34d399",
                          }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-zinc-600">
                        Shared space — grain and bales compete for the same sq ft. Remaining room:{" "}
                        <span className="text-zinc-400">{util.balanceMt.toFixed(0)} MT</span> or{" "}
                        <span className="text-zinc-400">{util.balanceBales.toFixed(0)} bales</span>{" "}
                        (after cross-converting what&apos;s already stored).
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="mt-0.5 font-medium text-zinc-300">{value}</div>
    </div>
  );
}

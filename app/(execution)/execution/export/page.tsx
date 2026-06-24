"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { startOfMonth, endOfMonth, subMonths } from "date-fns";
import { useState } from "react";
import { EXECUTION_PROFILES } from "@/lib/trade-constants";

const PROFILE_LABELS: Record<string, string> = {
  PURCHASE_DELIVERED: "Purchase — Delivered",
  PURCHASE_SPOT: "Purchase — Spot",
  SALE_EX_WAREHOUSE: "Sale — Ex-Warehouse",
};

const PRESETS = [
  { label: "This Month", offset: 0 },
  { label: "Last Month", offset: 1 },
  { label: "2 Months Ago", offset: 2 },
  { label: "3 Months Ago", offset: 3 },
];

export default function ExecutionExportPage() {
  const [from, setFrom] = useState(startOfMonth(new Date()).toISOString().slice(0, 10));
  const [to, setTo] = useState(endOfMonth(new Date()).toISOString().slice(0, 10));
  const [profile, setProfile] = useState("");
  const [exported, setExported] = useState(false);

  const { data: preview } = trpc.execution.lockedContracts.useQuery({
    from: new Date(from),
    to: new Date(to),
    profile: profile ? (profile as (typeof EXECUTION_PROFILES)[number]) : undefined,
  });

  const exportCsv = trpc.execution.exportLockedCsv.useMutation({
    onSuccess: (res) => {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    },
  });

  function applyPreset(offset: number) {
    const d = subMonths(new Date(), offset);
    setFrom(startOfMonth(d).toISOString().slice(0, 10));
    setTo(endOfMonth(d).toISOString().slice(0, 10));
  }

  const totalQtyMt = (preview ?? []).reduce((a, c) => a + c.contractualQtyMt, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
          Desk / <span style={{ color: "#a1a1aa" }}>Export CSV</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-white">Export Locked Trades</h1>
        <p className="mt-1 text-sm" style={{ color: "#71717a" }}>
          Download a CSV file of all locked contracts for a given period and contract type.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Export form */}
        <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <h2 className="mb-4 text-sm font-semibold text-white">Export Settings</h2>

          {/* Quick presets */}
          <div className="mb-4">
            <label className="mb-2 block text-[11px] font-medium uppercase tracking-wider" style={{ color: "#71717a" }}>Quick Presets</label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => applyPreset(p.offset)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: "#a1a1aa" }}>From Date</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: "#a1a1aa" }}>To Date</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: "#a1a1aa" }}>Contract Type (optional)</label>
              <select value={profile} onChange={(e) => setProfile(e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <option value="">All Types</option>
                {EXECUTION_PROFILES.map((p) => <option key={p} value={p}>{PROFILE_LABELS[p] ?? p}</option>)}
              </select>
            </div>
          </div>

          <button
            onClick={() => exportCsv.mutate({ from: new Date(from), to: new Date(to), profile: profile ? (profile as (typeof EXECUTION_PROFILES)[number]) : undefined })}
            disabled={exportCsv.isPending}
            className="mt-5 w-full rounded-xl py-3 text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: exported ? "rgba(52,211,153,0.2)" : "linear-gradient(135deg,#f59e0b,#d97706)", color: exported ? "#34d399" : "#000" }}>
            {exportCsv.isPending ? "Generating…" : exported ? "✓ Downloaded!" : "⬇ Download CSV"}
          </button>

          <p className="mt-2 text-[10px] text-center" style={{ color: "#52525b" }}>
            File: locked-trades-{from}.csv
          </p>
        </div>

        {/* Preview panel */}
        <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <h2 className="mb-2 text-sm font-semibold text-white">Preview ({preview?.length ?? 0} contracts)</h2>
          <p className="mb-4 text-xs" style={{ color: "#71717a" }}>
            Total Qty: <span className="font-bold text-white">{totalQtyMt.toFixed(0)}</span> · 
            Date: <span className="text-zinc-400">{from} to {to}</span>
          </p>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {(preview ?? []).slice(0, 20).map((c) => (
              <div key={c.tradeRef} className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <div>
                  <span className="font-mono text-xs font-semibold text-amber-400">{c.tradeRef}</span>
                  <span className="ml-2 text-xs" style={{ color: "#71717a" }}>{c.counterpartyName}</span>
                </div>
                <span className="text-xs tabular-nums text-zinc-400">{formatQtyWithUnit(c.contractualQtyMt, c.quantityUnit, 2)}</span>
              </div>
            ))}
            {(preview?.length ?? 0) > 20 && (
              <p className="pt-1 text-center text-xs" style={{ color: "#52525b" }}>
                …and {(preview?.length ?? 0) - 20} more
              </p>
            )}
            {preview?.length === 0 && (
              <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
                No contracts in this date range.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Format notes */}
      <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "#71717a" }}>CSV Columns</h3>
        <div className="flex flex-wrap gap-2">
          {["tradeRef", "profile", "direction", "counterparty", "commodityCode", "quantityUnit", "contractQty", "receivedQty", "openQty", "ratePerMaund", "currency", "lockedAt", "status"].map((col) => (
            <span key={col} className="rounded px-2 py-1 font-mono text-[10px]" style={{ background: "rgba(255,255,255,0.04)", color: "#71717a" }}>
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

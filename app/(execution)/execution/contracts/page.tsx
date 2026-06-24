"use client";

import { trpc } from "@/lib/trpc/client";
import { executionWorkspacePath } from "@/lib/execution-routes";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import Link from "next/link";
import { useState } from "react";
import { EXECUTION_PROFILES } from "@/lib/trade-constants";

const PROFILE_LABELS: Record<string, string> = {
  PURCHASE_DELIVERED: "Purchase — Delivered",
  PURCHASE_SPOT: "Purchase — Spot",
  SALE_EX_WAREHOUSE: "Sale — Ex-Warehouse",
};

const PROFILE_COLORS: Record<string, string> = {
  PURCHASE_DELIVERED: "#34d399",
  PURCHASE_SPOT: "#60a5fa",
  SALE_EX_WAREHOUSE: "#a78bfa",
};

export default function LockedContractsPage() {
  const [profile, setProfile] = useState<string>("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "Open" | "Close">("all");

  const { data: pending } = trpc.execution.pendingForLock.useQuery();
  const { data: contracts } = trpc.execution.lockedContracts.useQuery({
    openOnly: false,
    profile: profile ? (profile as (typeof EXECUTION_PROFILES)[number]) : undefined,
  });

  const filtered = (contracts ?? []).filter((c) => {
    const matchSearch = !search || c.tradeRef.toLowerCase().includes(search.toLowerCase()) || c.counterpartyName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.contractStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalOpen = (contracts ?? []).filter((c) => c.contractStatus === "Open").length;
  const totalClosed = (contracts ?? []).filter((c) => c.contractStatus !== "Open").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
          <Link href="/execution" className="hover:text-white">Desk</Link><span>/</span>
          <span style={{ color: "#a1a1aa" }}>Locked Contracts</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-white">Locked Contracts</h1>
        <p className="mt-1 text-sm" style={{ color: "#71717a" }}>All trades locked for execution across all contract types</p>
      </div>

      {/* Summary row */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-xl px-4 py-2.5 text-center" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <span className="text-xl font-bold" style={{ color: "#f59e0b" }}>{(contracts ?? []).length}</span>
          <span className="ml-2 text-xs" style={{ color: "#71717a" }}>Total Locked</span>
        </div>
        <div className="rounded-xl px-4 py-2.5 text-center" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.15)" }}>
          <span className="text-xl font-bold" style={{ color: "#34d399" }}>{totalOpen}</span>
          <span className="ml-2 text-xs" style={{ color: "#71717a" }}>Open</span>
        </div>
        <div className="rounded-xl px-4 py-2.5 text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-xl font-bold text-zinc-400">{totalClosed}</span>
          <span className="ml-2 text-xs" style={{ color: "#71717a" }}>Closed</span>
        </div>
        {(pending?.length ?? 0) > 0 && (
          <div className="rounded-xl px-4 py-2.5 text-center" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
            <span className="text-xl font-bold" style={{ color: "#f87171" }}>{pending?.length}</span>
            <span className="ml-2 text-xs" style={{ color: "#71717a" }}>Awaiting Lock</span>
          </div>
        )}
      </div>

      {/* Pending lock section */}
      {(pending?.length ?? 0) > 0 && (
        <div className="rounded-2xl p-5" style={{ background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.15)" }}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: "#f87171" }}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            Awaiting Lock from Trader
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Contract", "Trader", "Direction", "Qty", "Counterparty", "Commodity"].map((h) => (
                    <th key={h} className="pb-2 text-left font-medium uppercase tracking-wider" style={{ color: "#52525b" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(pending ?? []).map((t) => (
                  <tr key={t.tradeRef} className="border-b" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                    <td className="py-2 font-mono font-semibold" style={{ color: "#f87171" }}>{t.tradeRef}</td>
                    <td className="py-2 text-zinc-400">{t.traderName}</td>
                    <td className="py-2"><span style={{ color: t.direction === "BUY" ? "#34d399" : "#a78bfa" }}>{t.direction}</span></td>
                    <td className="py-2 tabular-nums text-zinc-300">{t.quantity} {t.quantityUnit}</td>
                    <td className="py-2 text-zinc-300">{t.counterpartyName}</td>
                    <td className="py-2 text-zinc-400">{t.commodityCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input placeholder="Search contract or counterparty…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-xl px-4 py-2.5 text-sm text-white outline-none"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }} />
        <select value={profile} onChange={(e) => setProfile(e.target.value)}
          className="rounded-xl px-4 py-2.5 text-sm text-white outline-none"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <option value="">All Types</option>
          {EXECUTION_PROFILES.map((p) => <option key={p} value={p}>{PROFILE_LABELS[p] ?? p}</option>)}
        </select>
        <div className="flex rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          {(["all", "Open", "Close"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className="px-4 py-2.5 text-xs font-medium transition-colors capitalize"
              style={{ background: statusFilter === s ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.03)", color: statusFilter === s ? "#f59e0b" : "#71717a" }}>
              {s === "Close" ? "Closed" : s}
            </button>
          ))}
        </div>
      </div>

      {/* Contracts table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["Contract No.", "Type", "Counterparty", "Contract Qty", "Received", "Open", "Progress", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium uppercase tracking-wider" style={{ color: "#52525b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const pct = c.contractualQtyMt > 0 ? Math.min(c.receivedQtyMt / c.contractualQtyMt, 1) : 0;
                const color = PROFILE_COLORS[c.executionProfile] ?? "#6b7280";
                return (
                  <tr key={c.tradeRef} className="hover:bg-white/[0.02] transition-colors"
                    style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }}>
                    <td className="px-4 py-3 font-mono font-bold" style={{ color }}>{c.tradeRef}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={{ background: `${color}15`, color }}>
                        {PROFILE_LABELS[c.executionProfile]?.split("—")[1]?.trim() ?? c.executionProfile}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{c.counterpartyName}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-300">{formatQtyWithUnit(c.contractualQtyMt, c.quantityUnit, 2)}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-400">{formatQtyWithUnit(c.receivedQtyMt, c.quantityUnit, 2)}</td>
                    <td className="px-4 py-3 tabular-nums text-zinc-300">{formatQtyWithUnit(c.openQtyMt, c.quantityUnit, 2)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: color }} />
                        </div>
                        <span className="tabular-nums" style={{ color: "#52525b" }}>{(pct * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                        style={{ background: c.contractStatus === "Open" ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.04)", color: c.contractStatus === "Open" ? "#34d399" : "#6b7280" }}>
                        {c.contractStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={executionWorkspacePath(c.tradeRef, c.executionProfile)}
                        className="text-[11px] font-medium hover:underline" style={{ color }}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-zinc-500">No contracts match your filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

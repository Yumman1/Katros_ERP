"use client";

import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import {
  collectCommodityOptions,
  matchesCommodityFilter,
} from "@/lib/execution-commodity-filter";
import { trpc } from "@/lib/trpc/client";
import { executionWorkspacePath } from "@/lib/execution-routes";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { EXECUTION_PROFILES, TRADE_SCOPES, TRADE_SCOPE_LABELS } from "@/lib/trade-constants";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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

export function LockedContractsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [profile, setProfile] = useState(() => searchParams.get("profile") ?? "");
  const [scopeFilter, setScopeFilter] = useState(() => searchParams.get("scope") ?? "");
  const [commodityFilter, setCommodityFilter] = useState(() => searchParams.get("commodity") ?? "ALL");
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState<"all" | "Open" | "Close">(() => {
    const s = searchParams.get("status");
    return s === "Open" || s === "Close" ? s : "all";
  });

  const syncUrl = useCallback(
    (next: {
      profile: string;
      scope: string;
      commodity: string;
      q: string;
      status: "all" | "Open" | "Close";
    }) => {
      const params = new URLSearchParams();
      if (next.profile) params.set("profile", next.profile);
      if (next.scope) params.set("scope", next.scope);
      if (next.commodity && next.commodity !== "ALL") params.set("commodity", next.commodity);
      if (next.q) params.set("q", next.q);
      if (next.status !== "all") params.set("status", next.status);
      const qs = params.toString();
      router.replace(qs ? `/execution/contracts?${qs}` : "/execution/contracts", { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    syncUrl({ profile, scope: scopeFilter, commodity: commodityFilter, q: search, status: statusFilter });
  }, [profile, scopeFilter, commodityFilter, search, statusFilter, syncUrl]);

  const { data: pending } = trpc.execution.pendingForLock.useQuery();
  const { data: contracts } = trpc.execution.lockedContracts.useQuery({
    openOnly: false,
    profile: profile ? (profile as (typeof EXECUTION_PROFILES)[number]) : undefined,
    tradeScope: scopeFilter ? (scopeFilter as (typeof TRADE_SCOPES)[number]) : undefined,
  });

  const commodityOptions = useMemo(
    () => collectCommodityOptions(contracts ?? []),
    [contracts],
  );

  const filtered = (contracts ?? []).filter((c) => {
    const matchSearch =
      !search ||
      c.tradeRef.toLowerCase().includes(search.toLowerCase()) ||
      c.counterpartyName.toLowerCase().includes(search.toLowerCase()) ||
      c.commodityCode.toLowerCase().includes(search.toLowerCase()) ||
      c.commodityName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.contractStatus === statusFilter;
    const matchCommodity = matchesCommodityFilter(c.commodityCode, commodityFilter);
    return matchSearch && matchStatus && matchCommodity;
  });

  const totalOpen = (contracts ?? []).filter((c) => c.contractStatus === "Open").length;
  const totalClosed = (contracts ?? []).filter((c) => c.contractStatus !== "Open").length;

  const hasActiveFilters =
    profile !== "" || scopeFilter !== "" || commodityFilter !== "ALL" || search !== "" || statusFilter !== "all";

  const clearFilters = () => {
    setProfile("");
    setScopeFilter("");
    setCommodityFilter("ALL");
    setSearch("");
    setStatusFilter("all");
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
          <Link href="/execution" className="hover:text-white">Desk</Link><span>/</span>
          <span style={{ color: "#a1a1aa" }}>Locked Contracts</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-white">Locked Contracts</h1>
        <p className="mt-1 text-sm" style={{ color: "#71717a" }}>
          Filter by market, contract type, and commodity — all locked trades in one place
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="rounded-xl px-4 py-2.5 text-center" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <span className="text-xl font-bold" style={{ color: "#f59e0b" }}>{filtered.length}</span>
          <span className="ml-2 text-xs" style={{ color: "#71717a" }}>Showing</span>
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

      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <input
            placeholder="Search contract, counterparty, or commodity…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[200px] flex-1 rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <option value="">All Markets</option>
            {TRADE_SCOPES.map((s) => <option key={s} value={s}>{TRADE_SCOPE_LABELS[s]}</option>)}
          </select>
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className="rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <option value="">All Types</option>
            {EXECUTION_PROFILES.map((p) => <option key={p} value={p}>{PROFILE_LABELS[p] ?? p}</option>)}
          </select>
          <div className="flex overflow-hidden rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
            {(["all", "Open", "Close"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className="px-4 py-2.5 text-xs font-medium capitalize transition-colors"
                style={{
                  background: statusFilter === s ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.03)",
                  color: statusFilter === s ? "#f59e0b" : "#71717a",
                }}
              >
                {s === "Close" ? "Closed" : s}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl px-4 py-2.5 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Clear filters
            </button>
          )}
        </div>

        <CommodityFilterBar
          commodities={commodityOptions}
          value={commodityFilter}
          onChange={setCommodityFilter}
        />
      </div>

      <div className="overflow-hidden rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["Contract No.", "Market", "Type", "Commodity", "Counterparty", "Contract Qty", "Received", "Open", "Progress", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium uppercase tracking-wider" style={{ color: "#52525b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const pct = c.contractualQtyMt > 0 ? Math.min(c.receivedQtyMt / c.contractualQtyMt, 1) : 0;
                const color = PROFILE_COLORS[c.executionProfile] ?? "#6b7280";
                return (
                  <tr
                    key={c.tradeRef}
                    className="transition-colors hover:bg-white/[0.02]"
                    style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }}
                  >
                    <td className="px-4 py-3 font-mono font-bold" style={{ color }}>{c.tradeRef}</td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                        style={{
                          background: c.tradeScope === "LOCAL" ? "rgba(52,211,153,0.12)" : "rgba(96,165,250,0.12)",
                          color: c.tradeScope === "LOCAL" ? "#34d399" : "#60a5fa",
                        }}
                      >
                        {TRADE_SCOPE_LABELS[c.tradeScope]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={{ background: `${color}15`, color }}>
                        {PROFILE_LABELS[c.executionProfile]?.split("—")[1]?.trim() ?? c.executionProfile}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-zinc-300">{c.commodityCode}</span>
                      <span className="ml-1 text-zinc-500">{c.commodityName}</span>
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
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                        style={{
                          background: c.contractStatus === "Open" ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.04)",
                          color: c.contractStatus === "Open" ? "#34d399" : "#6b7280",
                        }}
                      >
                        {c.contractStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={executionWorkspacePath(c.tradeRef, c.executionProfile)}
                        className="text-[11px] font-medium hover:underline"
                        style={{ color }}
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-sm text-zinc-500">No contracts match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

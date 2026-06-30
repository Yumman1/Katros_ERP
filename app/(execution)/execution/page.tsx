"use client";

import { TRADE_SCOPE_LABELS } from "@/lib/trade-constants";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { useSession } from "next-auth/react";

export default function ExecutionDeskPage() {
  const { data: session } = useSession();
  const { data: summary } = trpc.execution.deskSummary.useQuery(undefined, { refetchInterval: 30000 });
  const { data: pending } = trpc.execution.pendingForLock.useQuery();
  const { data: allContracts } = trpc.execution.lockedContracts.useQuery({});

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const kpis = [
    {
      label: "Locked Open",
      value: summary?.lockedOpen ?? 0,
      sub: `${summary?.lockedTotal ?? 0} total locked`,
      href: "/execution/contracts",
      color: "#f59e0b",
      bg: "rgba(245,158,11,0.08)",
      border: "rgba(245,158,11,0.15)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      label: "Local — Purchase Delivered",
      value: summary?.localPurchaseDeliveredOpen ?? 0,
      sub: `${summary?.localOpen ?? 0} local open total`,
      href: "/execution/local/purchase-delivered",
      color: "#34d399",
      bg: "rgba(52,211,153,0.08)",
      border: "rgba(52,211,153,0.15)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      ),
    },
    {
      label: "Intl — Purchase Delivered",
      value: summary?.internationalPurchaseDeliveredOpen ?? 0,
      sub: `${summary?.internationalOpen ?? 0} intl open total`,
      href: "/execution/international/purchase-delivered",
      color: "#2dd4bf",
      bg: "rgba(45,212,191,0.08)",
      border: "rgba(45,212,191,0.15)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      ),
    },
    {
      label: "Local — Purchase Spot",
      value: summary?.localPurchaseSpotOpen ?? 0,
      sub: "In pipeline",
      href: "/execution/local/purchase-spot",
      color: "#60a5fa",
      bg: "rgba(96,165,250,0.08)",
      border: "rgba(96,165,250,0.15)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
        </svg>
      ),
    },
    {
      label: "Intl — Purchase Spot",
      value: summary?.internationalPurchaseSpotOpen ?? 0,
      sub: "In pipeline",
      href: "/execution/international/purchase-spot",
      color: "#818cf8",
      bg: "rgba(129,140,248,0.08)",
      border: "rgba(129,140,248,0.15)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
        </svg>
      ),
    },
    {
      label: "Local — Sales",
      value: summary?.localSaleOpen ?? 0,
      sub: "Ex-warehouse",
      href: "/execution/local/sales",
      color: "#a78bfa",
      bg: "rgba(167,139,250,0.08)",
      border: "rgba(167,139,250,0.15)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      ),
    },
    {
      label: "Intl — Sales",
      value: summary?.internationalSaleOpen ?? 0,
      sub: "Ex-warehouse",
      href: "/execution/international/sales",
      color: "#c084fc",
      bg: "rgba(192,132,252,0.08)",
      border: "rgba(192,132,252,0.15)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      ),
    },
    {
      label: "Vehicles Today",
      value: summary?.vehiclesToday ?? 0,
      sub: "In/Out movements",
      href: "/execution/inventory",
      color: "#fb923c",
      bg: "rgba(251,146,60,0.08)",
      border: "rgba(251,146,60,0.15)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
          <path strokeLinecap="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 .009M13 8h4l4 4v4h-1M5 16h6" />
        </svg>
      ),
    },
    {
      label: "Unassigned Trucks",
      value: summary?.pendingTrucksUnassigned ?? 0,
      sub: "From gatepass link",
      href: "/execution/inventory",
      color: "#fbbf24",
      bg: "rgba(251,191,36,0.08)",
      border: "rgba(251,191,36,0.15)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
          <path strokeLinecap="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 .009M13 8h4l4 4v4h-1M5 16h6" />
        </svg>
      ),
    },
    {
      label: "Finance Pending",
      value: summary?.pendingFinance ?? 0,
      sub: "Awaiting approval",
      href: "/execution/payments",
      color: summary?.pendingFinance ? "#f87171" : "#6b7280",
      bg: summary?.pendingFinance ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.03)",
      border: summary?.pendingFinance ? "rgba(248,113,113,0.2)" : "rgba(255,255,255,0.06)",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  // Recent contracts for quick-view
  const recentContracts = (allContracts ?? []).slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {greeting},{" "}
            <span style={{ color: "#f59e0b" }}>{session?.user?.name?.split(" ")[0] ?? "Asad"}</span>
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#71717a" }}>
            Execution Operations · {new Date().toLocaleDateString("en-PK", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <Link href="/execution/export"
          className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white"
          style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((k) => {
          const Card = k.href ? Link : "div";
          return (
            <Card
              key={k.label}
              href={k.href as string}
              className="group relative overflow-hidden rounded-2xl p-4 transition-all duration-200"
              style={{ background: k.bg, border: `1px solid ${k.border}` }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "#71717a" }}>{k.label}</p>
                  <p className="mt-1.5 text-3xl font-bold tabular-nums" style={{ color: k.color }}>
                    {k.value}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: "#52525b" }}>{k.sub}</p>
                </div>
                <div className="rounded-xl p-2.5" style={{ background: `${k.color}22`, color: k.color }}>
                  {k.icon}
                </div>
              </div>
              {k.href && (
                <div className="mt-3 flex items-center gap-1 text-xs font-medium transition-colors group-hover:gap-2"
                  style={{ color: k.color }}>
                  View →
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Pending lock alert */}
      {(pending?.length ?? 0) > 0 && (
        <div className="rounded-2xl p-4" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 flex-shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-sm font-semibold text-amber-400">
              {pending?.length} trade{pending?.length !== 1 ? "s" : ""} awaiting lock
            </h2>
          </div>
          <p className="ml-6 mt-1 text-xs" style={{ color: "#a1a1aa" }}>
            Trader must lock these before execution can proceed.
          </p>
          <ul className="ml-6 mt-2 space-y-1">
            {(pending ?? []).slice(0, 5).map((t) => (
              <li key={t.tradeRef} className="flex items-center gap-3 text-xs">
                <span className="font-mono font-semibold text-amber-400">{t.tradeRef}</span>
                <span style={{ color: "#71717a" }}>·</span>
                <span style={{ color: "#a1a1aa" }}>{t.counterpartyName}</span>
                <span style={{ color: "#71717a" }}>·</span>
                <span style={{ color: "#71717a" }}>{formatQtyWithUnit(t.quantity, t.quantityUnit, 2)}</span>
              </li>
            ))}
          </ul>
          <Link href="/execution/contracts" className="ml-6 mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-400 hover:underline">
            View all →
          </Link>
        </div>
      )}

      {/* Active contracts table */}
      <div className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-sm font-semibold text-white">Active Contracts</h2>
          <Link href="/execution/contracts" className="text-xs font-medium text-amber-400 hover:underline">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {["Contract No.", "Market", "Type", "Counterparty", "Contractual Qty", "Received", "Open", "Status"].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left font-medium uppercase tracking-wider" style={{ color: "#52525b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentContracts.map((c, i) => {
                const pct = c.contractualQtyMt > 0 ? c.receivedQtyMt / c.contractualQtyMt : 0;
                const profileLabel =
                  c.executionProfile === "PURCHASE_DELIVERED" ? "PUR-DEL"
                  : c.executionProfile === "PURCHASE_SPOT" ? "PUR-SPOT"
                  : "SALE";
                const profileColor =
                  c.executionProfile === "PURCHASE_DELIVERED" ? "#34d399"
                  : c.executionProfile === "PURCHASE_SPOT" ? "#60a5fa"
                  : "#a78bfa";
                return (
                  <tr key={c.tradeRef}
                    className="group cursor-pointer transition-colors hover:bg-white/[0.02]"
                    style={{ borderBottom: i < recentContracts.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }}>
                    <td className="px-5 py-3">
                      <Link href={`/execution/${c.executionProfile === "SALE_EX_WAREHOUSE" ? "sales" : c.executionProfile === "PURCHASE_SPOT" ? "purchase-spot" : "purchase-delivered"}/${encodeURIComponent(c.tradeRef)}`}
                        className="font-mono font-semibold text-amber-400 hover:underline">
                        {c.tradeRef}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                        style={{
                          background: c.tradeScope === "LOCAL" ? "rgba(52,211,153,0.12)" : "rgba(96,165,250,0.12)",
                          color: c.tradeScope === "LOCAL" ? "#34d399" : "#60a5fa",
                        }}>
                        {TRADE_SCOPE_LABELS[c.tradeScope]}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: `${profileColor}18`, color: profileColor }}>
                        {profileLabel}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-zinc-300">{c.counterpartyName}</td>
                    <td className="px-5 py-3 tabular-nums text-zinc-300">{formatQtyWithUnit(c.contractualQtyMt, c.quantityUnit, 2)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(pct * 100, 100)}%`, background: "#f59e0b" }} />
                        </div>
                        <span className="tabular-nums text-zinc-400">{formatQtyWithUnit(c.receivedQtyMt, c.quantityUnit, 1)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 tabular-nums text-zinc-300">{formatQtyWithUnit(c.openQtyMt, c.quantityUnit, 1)}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${c.contractStatus === "Open" ? "text-green-400" : "text-zinc-500"}`}
                        style={{ background: c.contractStatus === "Open" ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.04)" }}>
                        {c.contractStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {recentContracts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <svg className="mb-3 h-10 w-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <p className="text-sm">No locked contracts yet.</p>
              <p className="text-xs mt-1 text-zinc-600">Trader must lock a trade to begin execution.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

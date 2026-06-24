"use client";

import Link from "next/link";
import { MapPin, Warehouse } from "lucide-react";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

const nav = [
  {
    href: "/execution",
    label: "Desk Overview",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
    exact: true,
  },
  {
    href: "/execution/contracts",
    label: "Locked Contracts",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: "/execution/purchase-delivered",
    label: "Purchase — Delivered",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    ),
  },
  {
    href: "/execution/purchase-spot",
    label: "Purchase — Spot",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
      </svg>
    ),
  },
  {
    href: "/execution/sales",
    label: "Sales (Ex-Warehouse)",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    ),
  },
  {
    href: "/execution/inventory",
    label: "Inventory",
    icon: <Warehouse className="h-4 w-4" strokeWidth={1.8} />,
  },
  {
    href: "/execution/warehouses",
    label: "Warehouses",
    icon: <MapPin className="h-4 w-4" strokeWidth={1.8} />,
  },
  {
    href: "/execution/payments",
    label: "Finance Queue",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" d="M9 8h6m-5 0a3 3 0 110 6H9l3 3m-3-6h6m6 1a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    badge: true,
  },
  {
    href: "/execution/export",
    label: "Export CSV",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    ),
  },
];

export function ExecutionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { data: summary } = trpc.execution.deskSummary.useQuery(undefined, { refetchInterval: 30000 });

  const initials = session?.user?.name
    ? session.user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "EX";

  return (
    <div className="flex min-h-screen" style={{ background: "#0b0d11" }}>
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 flex h-full w-[248px] flex-col"
        style={{ background: "linear-gradient(180deg, #0f1117 0%, #0b0d11 100%)", borderRight: "1px solid rgba(255,255,255,0.06)" }}>

        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}>
            <svg className="h-5 w-5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
              <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white">Kastros CTRM</div>
            <div className="text-[10px] font-medium tracking-widest" style={{ color: "#f59e0b" }}>EXECUTION DESK</div>
          </div>
        </div>

        {/* Summary chips */}
        {summary && (
          <div className="mx-4 mb-3 grid grid-cols-3 gap-1.5 rounded-xl p-2"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <MiniStat label="Open" value={summary.lockedOpen} />
            <MiniStat label="Today" value={summary.vehiclesToday} />
            <MiniStat label="Pending₹" value={summary.pendingFinance} warn />
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "text-amber-400"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-white",
                )}
                style={active ? { background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.15)" } : {}}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-amber-400" />
                )}
                <span className={cn("flex-shrink-0 transition-colors", active ? "text-amber-400" : "text-zinc-500 group-hover:text-zinc-300")}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {item.badge && summary?.pendingFinance ? (
                  <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
                    style={{ background: "rgba(239,68,68,0.2)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>
                    {summary.pendingFinance}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="mx-4 mb-4 mt-2 rounded-xl p-3"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)", color: "white" }}>
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{session?.user?.name ?? "Execution User"}</div>
              <div className="truncate text-[10px]" style={{ color: "#71717a" }}>{session?.user?.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-2.5 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 pl-[248px]">
        <div className="mx-auto max-w-7xl p-6">{children}</div>
      </main>
    </div>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg py-1.5"
      style={{ background: warn && value > 0 ? "rgba(239,68,68,0.08)" : "transparent" }}>
      <span className={cn("text-base font-bold tabular-nums", warn && value > 0 ? "text-red-400" : "text-white")}>{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</span>
    </div>
  );
}

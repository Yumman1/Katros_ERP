"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PriceTicker } from "@/components/modules/price-ticker";

type NavLink = { href: string; label: string };
type NavGroup = { label: string; children: NavLink[] };
type NavEntry = NavLink | NavGroup;

const nav: NavEntry[] = [
  { href: "/", label: "Dashboard" },
  {
    label: "Position & P&L",
    children: [
      { href: "/positions", label: "Positions" },
      { href: "/mtm", label: "MTM" },
      { href: "/pnl", label: "P&L Explained" },
    ],
  },
  {
    label: "Finance",
    children: [
      { href: "/finance/payments", label: "Payment approvals" },
      { href: "/cashflow", label: "Cash Flow" },
      { href: "/reconciliation", label: "Reconciliation" },
    ],
  },
  {
    label: "Supply Chain",
    children: [
      { href: "/supply-chain", label: "Operations Hub" },
      { href: "/inventory", label: "Inventory" },
      { href: "/shipments", label: "Shipments" },
      { href: "/locations", label: "Locations" },
      { href: "/suppliers", label: "Suppliers" },
      { href: "/traceability", label: "Traceability" },
    ],
  },
  {
    label: "Reporting",
    children: [
      { href: "/reports", label: "Reports" },
      { href: "/analytics", label: "Analytics" },
    ],
  },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <div className="flex min-h-screen bg-kastros-bg">
      <aside className="fixed left-0 top-0 z-40 flex h-full w-[240px] flex-col border-r border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-4 py-4">
          <div className="text-lg font-semibold tracking-tight text-white">Kastros</div>
          <div className="text-xs text-zinc-500">CTRM</div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 text-sm">
          {nav.map((item) =>
          "href" in item ? (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "block rounded-md px-2 py-2 text-zinc-300 hover:bg-white/5 hover:text-white",
                pathname === item.href && "bg-white/10 text-kastros-green",
              )}
            >
              {item.label}
            </Link>
          ) : (
              <div key={item.label} className="pt-3">
                <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  {item.label}
                </div>
                {item.children.map((c) => (
                  <Link
                    key={c.href}
                    href={c.href}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-zinc-300 hover:bg-white/5 hover:text-white",
                      pathname === c.href && "bg-white/10 text-kastros-green",
                    )}
                  >
                    {c.label}
                  </Link>
                ))}
              </div>
            )
          )}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col pl-[240px]">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b border-kastros-border bg-kastros-bg/95 px-4 backdrop-blur">
          <div className="text-sm font-medium text-zinc-400">
            {new Date().toLocaleString("en-PK", {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              day: "numeric",
              month: "short",
            })}
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <PriceTicker />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-zinc-400 md:inline">{session?.user?.email}</span>
            <span className="rounded bg-kastros-border px-2 py-0.5 text-xs text-kastros-green">
              {session?.user?.role}
            </span>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="rounded-md border border-kastros-border px-2 py-1 text-zinc-300 hover:bg-white/5"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}

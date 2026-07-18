"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ShellHeader } from "@/components/layout/shell-header";
import { DeferredPriceTicker } from "@/components/modules/deferred-price-ticker";

type NavLink = { href: string; label: string };
type NavGroup = { label: string; children: NavLink[] };
type NavEntry = NavLink | NavGroup;

const nav: NavEntry[] = [
  { href: "/overview", label: "Dashboard" },
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
      { href: "/finance/change-requests", label: "Change requests" },
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

function toAppNav(entries: NavEntry[]) {
  return entries.map((item) =>
    "children" in item
      ? { label: item.label, items: item.children.map((c) => ({ href: c.href, label: c.label })) }
      : { href: item.href, label: item.label },
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <AppShell
      brandSubtitle="Control Tower"
      pathname={pathname}
      nav={toAppNav(nav)}
      header={
        <ShellHeader
          left={new Date().toLocaleString("en-PK", {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            day: "numeric",
            month: "short",
          })}
          center={<DeferredPriceTicker />}
        />
      }
    >
      {children}
    </AppShell>
  );
}

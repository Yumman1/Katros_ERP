"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ShellHeader } from "@/components/layout/shell-header";
import { DeferredPriceTicker } from "@/components/modules/deferred-price-ticker";
import { trpc } from "@/lib/trpc/client";

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
      { href: "/finance/delivery-order-approvals", label: "DO approvals" },
      { href: "/finance/ledgers", label: "Ledgers" },
      { href: "/finance/vouchers", label: "Vouchers" },
      { href: "/finance/rejections", label: "Rejections" },
      { href: "/finance/change-requests", label: "Change requests" },
      { href: "/finance/policies", label: "Policies" },
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

function countBadge(count: number | undefined) {
  return count ? (
    <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-bold text-warning">
      {count}
    </span>
  ) : undefined;
}

function toAppNav(entries: NavEntry[], badges: Record<string, number | undefined>) {
  return entries.map((item) =>
    "children" in item
      ? {
          label: item.label,
          items: item.children.map((c) => ({
            href: c.href,
            label: c.label,
            badge: countBadge(badges[c.href]),
          })),
        }
      : { href: item.href, label: item.label },
  );
}

/** Roles that see the Finance nav group and may call the finance badge queries. */
const FINANCE_NAV_ROLES = new Set(["FINANCE", "ADMIN", "CEO"]);

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? null;
  const canSeeFinance = role != null && FINANCE_NAV_ROLES.has(role);

  const pendingVouchers = trpc.finance.pendingVouchersCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
    enabled: canSeeFinance,
  });
  const pendingPayments = trpc.finance.pendingPayments.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
    enabled: canSeeFinance,
  });

  const badges: Record<string, number | undefined> = {
    "/finance/vouchers": pendingVouchers.data,
    "/finance/payments": pendingPayments.data?.length,
  };

  const visibleNav = canSeeFinance
    ? nav
    : nav.filter((entry) => !("children" in entry) || entry.label !== "Finance");

  return (
    <AppShell
      brandSubtitle="Control Tower"
      pathname={pathname}
      nav={toAppNav(visibleNav, badges)}
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

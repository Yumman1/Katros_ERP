"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ShellHeader } from "@/components/layout/shell-header";
import { DeferredPriceTicker } from "@/components/modules/deferred-price-ticker";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

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
      { href: "/finance/vouchers", label: "Voucher approvals" },
      { href: "/finance/ledgers", label: "Ledgers" },
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
  return count && count > 0 ? (
    <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-warning/15 px-1.5 text-[10px] font-bold text-warning">
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

  const approvalBadges = trpc.finance.approvalBadges.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
    staleTime: 15_000,
    retry: false,
    enabled: canSeeFinance,
  });

  const badges: Record<string, number | undefined> = {
    "/finance/payments": approvalBadges.data?.payments,
    "/finance/delivery-order-approvals": approvalBadges.data?.doApprovals,
    "/finance/vouchers": approvalBadges.data?.vouchers,
    "/finance/change-requests": approvalBadges.data?.changeRequests,
  };

  const visibleNav = canSeeFinance
    ? nav
    : nav.filter((entry) => !("children" in entry) || entry.label !== "Finance");

  return (
    <AppShell
      brandSubtitle="Control Tower"
      pathname={pathname}
      nav={toAppNav(visibleNav, badges)}
      sidebarTop={
        canSeeFinance && approvalBadges.data ? (
          <div className="mx-4 mb-2 mt-3 grid grid-cols-4 gap-1 rounded-xl border border-border bg-foreground/[0.03] p-2">
            <MiniStat label="Pay" value={approvalBadges.data.payments} warn />
            <MiniStat label="DO" value={approvalBadges.data.doApprovals} warn />
            <MiniStat label="VCH" value={approvalBadges.data.vouchers} warn />
            <MiniStat label="Edits" value={approvalBadges.data.changeRequests} warn />
          </div>
        ) : null
      }
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

function MiniStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg py-1.5",
        warn && value > 0 && "bg-[color-mix(in_srgb,var(--warning)_12%,transparent)]",
      )}
    >
      <span
        className={cn(
          "text-sm font-bold tabular-nums",
          warn && value > 0 ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[8px] uppercase tracking-wider text-subtle">{label}</span>
    </div>
  );
}

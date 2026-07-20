"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { LayoutDashboard, LineChart, ListOrdered, PenLine, Plus, Receipt, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ShellHeader } from "@/components/layout/shell-header";
import { trpc } from "@/lib/trpc/client";

import { DeferredPriceTicker } from "@/components/modules/deferred-price-ticker";

const nav = [
  { href: "/trader", label: "My Desk", icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { href: "/trader/trades", label: "My Trades", icon: <ListOrdered className="h-4 w-4" /> },
  { href: "/trader/fulfillment", label: "Fulfillment", icon: <Truck className="h-4 w-4" /> },
  { href: "/trader/invoice-approvals", label: "Invoice approvals", icon: <Receipt className="h-4 w-4" /> },
  { href: "/trader/positions", label: "Positions", icon: <LineChart className="h-4 w-4" /> },
  { href: "/trader/market", label: "Market", icon: <LineChart className="h-4 w-4" /> },
  { href: "/trader/change-requests", label: "Change Requests", icon: <PenLine className="h-4 w-4" /> },
];

export function TraderShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const firstName = session?.user?.name?.split(" ")[0] ?? "Trader";
  const approvals = trpc.trader.invoiceApprovalsCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });

  const appNav = nav.map((item) => ({
    ...item,
    badge:
      item.href === "/trader/invoice-approvals" && approvals.data ? (
        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-bold text-warning">
          {approvals.data}
        </span>
      ) : undefined,
  }));

  return (
    <AppShell
      brandSubtitle="Trading Desk"
      pathname={pathname}
      nav={appNav}
      sidebarTop={
        <div className="border-b border-border px-4 py-3">
          <Link href="/trader/trades/new" className="kastros-btn-primary w-full">
            <Plus className="h-4 w-4" />
            Book Trade
          </Link>
        </div>
      }
      header={
        <ShellHeader
          left={`Good ${getGreeting()}, ${firstName}`}
          center={<DeferredPriceTicker />}
        />
      }
    >
      {children}
    </AppShell>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

"use client";
import { useCommodityDesk } from "@/components/trader/commodity-desk-provider";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { BookOpen, LayoutDashboard, LineChart, ListOrdered, PenLine, Plus, Receipt, Truck, User, Users, Warehouse, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ShellHeader } from "@/components/layout/shell-header";
import { trpc } from "@/lib/trpc/client";
import { ENTITY_NAMES } from "@/lib/sesame-entity";

import { DeferredPriceTicker } from "@/components/modules/deferred-price-ticker";

const nav = [
  { href: "/trader", label: "My Desk", icon: <LayoutDashboard className="h-4 w-4" />, exact: true },
  { href: "/trader/trades", label: "My Trades", icon: <ListOrdered className="h-4 w-4" /> },
  { href: "/trader/fulfillment", label: "Fulfillment", icon: <Truck className="h-4 w-4" /> },
  { href: "/trader/invoice-approvals", label: "Invoice approvals", icon: <Receipt className="h-4 w-4" /> },
  { href: "/trader/approvals", label: "Approvals", icon: <PenLine className="h-4 w-4" /> },
  { href: "/trader/rejections", label: "Rejections", icon: <XCircle className="h-4 w-4" /> },
  { href: "/trader/positions", label: "Positions", icon: <LineChart className="h-4 w-4" /> },
  { href: "/trader/reports", label: "Sales reports", icon: <LineChart className="h-4 w-4" /> },
  { href: "/trader/ledgers", label: "Ledgers", icon: <BookOpen className="h-4 w-4" /> },
  { href: "/trader/counterparties", label: "Counterparties", icon: <Users className="h-4 w-4" /> },
  { href: "/trader/market", label: "Market", icon: <LineChart className="h-4 w-4" /> },
  { href: "/account", label: "Account", icon: <User className="h-4 w-4" /> },
];

function navBadge(count: number | undefined) {
  if (!count) return undefined;
  return (
    <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-bold text-warning">
      {count}
    </span>
  );
}

export function TraderShell({ children }: { children: ReactNode }) {
  const desk = useCommodityDesk();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const firstName = session?.user?.name?.split(" ")[0] ?? "Trader";
  const buyApprovals = trpc.trader.invoiceApprovalsCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const sellApprovals = trpc.trader.sellInvoiceApprovalsCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const editApprovals = trpc.trader.executionEditApprovalsCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const overDeliveryApprovals = trpc.trader.overDeliveryApprovalsCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });

  const groupedDos=trpc.sesameExport.list.useQuery(undefined,{refetchInterval:15000,retry:false});
  const groupedDoCount=groupedDos.data?.filter(s=>s.status==="TRADER_PENDING").length??0;
  const appNav = nav.flatMap((item) => {
    const mapped = {
      ...item,
      badge:
        // Both destinations are tabbed, so each badge is the sum of its tabs.
        item.href === "/trader/invoice-approvals"
          ? navBadge((buyApprovals.data ?? 0) + (sellApprovals.data ?? 0))
          : item.href === "/trader/approvals"
            ? navBadge((editApprovals.data ?? 0) + (overDeliveryApprovals.data ?? 0) + groupedDoCount)
            : undefined,
    };
    if (item.href === "/trader/positions") {
      return [{ href: "/trader/inventory", label: "Inventory", icon: <Warehouse className="h-4 w-4" /> }, mapped];
    }
    return [mapped];
  });

  return (
    <AppShell
      brandSubtitle={desk.active ? `${desk.active.name}${desk.sesame ? desk.entity === "FZCO" ? " · Dubai FZCO" : " · Pakistan" : ""} Desk` : "Trading Desk"}
      pathname={pathname}
      nav={appNav}
      sidebarTop={
        <div className="border-b border-border px-4 py-3">
          <label className="mb-3 block text-xs text-subtle">
            Commodity dashboard
            <select aria-label="Commodity dashboard" className="kastros-select mt-1 w-full" value={desk.active?.id ?? ""} onChange={e => { desk.select(e.target.value); router.push("/trader"); }} disabled={!desk.desks.length}>
              {!desk.desks.length && <option value="">{desk.loading ? "Loading…" : "No assigned commodities"}</option>}
              {desk.desks.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}
            </select>
          </label>
          {desk.sesame && (
            <fieldset className="mb-3">
              <legend className="mb-2 text-xs text-subtle">Sesame desk</legend>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
                {(["PAK", "FZCO"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={desk.entity === value}
                    onClick={() => desk.selectEntity(value)}
                    className={`rounded-md px-2 py-2 text-xs ${desk.entity === value ? "bg-accent-secondary text-white" : "text-muted-foreground"}`}
                  >
                    {value === "PAK" ? "Pakistan" : ENTITY_NAMES[value]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <Link href="/trader/trades/new" className="kastros-btn-primary w-full">
            <Plus className="h-4 w-4" />
            Book Trade
          </Link>
        </div>
      }
      header={
        <ShellHeader
          left={`Good ${getGreeting()}, ${firstName}`}
          center={<DeferredPriceTicker preferCode={desk.active?.code} />}
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

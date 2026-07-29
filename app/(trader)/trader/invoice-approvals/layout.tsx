"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/trader/invoice-approvals/buy", label: "Buy invoices" },
  { href: "/trader/invoice-approvals/sell", label: "Sell invoices" },
] as const;

/**
 * Buy and sell invoice approvals are the same decision on opposite sides of the
 * book, so they live under one page with a tab each. The header and the counts
 * stay put while switching, and each tab keeps its own URL.
 */
export default function InvoiceApprovalsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const buyCount = trpc.trader.invoiceApprovalsCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const sellCount = trpc.trader.sellInvoiceApprovalsCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });

  const countFor = (href: string) =>
    href.endsWith("/buy") ? buyCount.data : sellCount.data;

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Invoice approvals"
        subtitle="Gate invoices waiting on your decision — purchases you pay for, and sales you release against."
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          const count = countFor(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium",
                active
                  ? "border-success bg-success/10 text-success"
                  : "border-kastros-border text-muted-foreground hover:bg-foreground/5",
              )}
            >
              {tab.label}
              {count ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                    active ? "bg-success/20 text-success" : "bg-warning/20 text-warning",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/trader/approvals/trade-changes", label: "Trade changes" },
  { href: "/trader/approvals/over-delivery", label: "Over-delivery" },
] as const;

/**
 * Everything waiting on the trader's sign-off, one tab per kind. Each tab keeps
 * its own count so the other queue is never out of sight, and its own URL so it
 * can still be linked to.
 */
export default function TraderApprovalsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const editCount = trpc.trader.executionEditApprovalsCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const overDeliveryCount = trpc.trader.overDeliveryApprovalsCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });

  const countFor = (href: string) =>
    href.endsWith("/trade-changes") ? editCount.data : overDeliveryCount.data;

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Approvals"
        subtitle="Waiting on your sign-off: execution's changes to your trades, and inbound trucks delivering more than a trade can absorb."
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

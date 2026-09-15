"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { REJECTION_TAB_KINDS } from "@/lib/rejection-kinds";

const TABS = [
  { href: "/trader/rejections/all", label: "All", kinds: null },
  {
    href: "/trader/rejections/trade-changes",
    label: "Trade changes",
    kinds: REJECTION_TAB_KINDS.tradeChanges,
  },
  {
    href: "/trader/rejections/over-delivery",
    label: "Over-delivery",
    kinds: REJECTION_TAB_KINDS.overDelivery,
  },
] as const;

/**
 * Rejections split the same way approvals do, so a turned-down request is found
 * where the request itself lived. "All" stays first — voucher, payment, release
 * and settlement rejections belong to neither tab and must not disappear.
 */
export default function RejectionsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: rows } = trpc.policy.rejections.useQuery({ fullHistory: true }, {
    refetchInterval: 60_000,
  });

  const countFor = (kinds: readonly string[] | null) =>
    !rows ? undefined : kinds ? rows.filter((r) => kinds.includes(r.kind)).length : rows.length;

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Rejections"
        subtitle="Requests on your trades that were turned down — each with the reason it was rejected and who rejected it."
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          const count = countFor(tab.kinds);
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
                    active ? "bg-success/20 text-success" : "bg-foreground/[0.08] text-subtle",
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { cn } from "@/lib/utils";

const tabs = [
  { path: "do", label: "DO approvals", key: "doApprovals" },
  { path: "payments", label: "Payment approvals", key: "payments" },
  { path: "vouchers", label: "Voucher approvals", key: "vouchers" },
] as const;

export function FinanceApprovalsTabs() {
  const pathname = usePathname();
  const counts = trpc.finance.approvalBadges.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS, staleTime: 15_000, retry: false,
  });
  const total = counts.data
    ? counts.data.payments + counts.data.doApprovals + counts.data.vouchers
    : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <span role="status" className="rounded-full bg-warning/15 px-3 py-1 text-xs text-warning">
          {counts.error ? "Pending counts unavailable" : total == null ? "Loading counts…" : total ? `${total} pending` : "No pending approvals"}
        </span>
      </div>
      <nav aria-label="Finance approval types" className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const href = `/finance/approvals/${tab.path}`;
          const active = pathname === href;
          const count = counts.data?.[tab.key];
          return (
            <Link key={tab.path} href={href} aria-current={active ? "page" : undefined}
              className={cn("inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm", active ? "border-brand bg-brand/10 text-foreground" : "border-border text-muted-foreground hover:bg-foreground/5")}>
              {tab.label}
              {count != null && <span aria-label={`${count} pending`} className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", count > 0 ? "bg-warning/15 text-warning" : "bg-foreground/5 text-subtle")}>{count}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

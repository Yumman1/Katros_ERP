"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/execution/my-approvals/approvals", label: "Approvals", match: "approvals" as const },
  { href: "/execution/my-approvals/rejections", label: "Rejections", match: "rejections" as const },
] as const;

function activeTab(pathname: string): (typeof TABS)[number]["match"] {
  if (pathname.startsWith("/execution/my-approvals/rejections")) return "rejections";
  return "approvals";
}

export function ExecutionMyApprovalsTabs() {
  const pathname = usePathname();
  const current = activeTab(pathname);
  const { data: mine } = trpc.team.myChangeRequests.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
  });

  const approvalCount =
    mine?.filter((r) => ["PENDING", "PENDING_CEO", "APPROVED"].includes(r.status)).length ?? 0;
  const rejectionCount = mine?.filter((r) => r.status === "REJECTED").length ?? 0;

  const countFor = (match: (typeof TABS)[number]["match"]) =>
    match === "approvals" ? approvalCount : rejectionCount;

  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const active = current === tab.match;
        const count = countFor(tab.match);
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
            {count > 0 ? (
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
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment } from "@/lib/departments";
import { cn } from "@/lib/utils";

const TAB_ROUTES = [
  { href: "/execution/approvals", match: "team" as const },
  { href: "/execution/approvals/do", label: "DO approvals", match: "do" as const },
  { href: "/execution/approvals/rejections", label: "Rejections", match: "rejections" as const },
] as const;

function activeTab(pathname: string): (typeof TAB_ROUTES)[number]["match"] {
  if (pathname.startsWith("/execution/approvals/do")) return "do";
  if (pathname.startsWith("/execution/approvals/rejections")) return "rejections";
  return "team";
}

export function ExecutionApprovalsTabs() {
  const pathname = usePathname();
  const current = activeTab(pathname);
  const { role, isHead } = useTeam();
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");

  const tabs = TAB_ROUTES.map((tab) =>
    tab.match === "team"
      ? { ...tab, label: isExecutionHead ? "Team Approvals" : "My Approvals" }
      : tab,
  );

  const { data: pendingTeam } = trpc.team.pendingApprovals.useQuery(
    { department: "EXECUTION" },
    {
      enabled: isExecutionHead,
      refetchInterval: DESK_REFETCH_MS,
      staleTime: DESK_REFETCH_MS,
    },
  );
  const { data: pendingDo } = trpc.execution.doExecutionApprovals.useQuery(undefined, {
    enabled: isExecutionHead,
    refetchInterval: DESK_REFETCH_MS,
    staleTime: DESK_REFETCH_MS,
  });
  const { data: rejections } = trpc.policy.rejections.useQuery(undefined, {
    refetchInterval: DESK_REFETCH_MS,
    staleTime: DESK_REFETCH_MS,
  });

  const countFor = (match: (typeof TAB_ROUTES)[number]["match"]) => {
    if (match === "team") return isExecutionHead ? pendingTeam : undefined;
    if (match === "do") return isExecutionHead ? pendingDo?.length : undefined;
    return rejections?.length;
  };

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
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
            {count != null && count > 0 ? (
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

"use client";

import {
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  LayoutGrid,
  LineChart,
  MapPin,
  MoveRight,
  Receipt,
  ShieldCheck,
  TrendingUp,
  Truck,
  Warehouse,
  FileEdit,
  XCircle,
} from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ShellHeader } from "@/components/layout/shell-header";
import { trpc } from "@/lib/trpc/client";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment } from "@/lib/departments";
import { cn } from "@/lib/utils";

export function ExecutionShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { role, isHead } = useTeam();
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");
  // retry: false — non-execution visitors would otherwise 403-loop on these.
  const { data: summary } = trpc.execution.deskSummary.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const { data: pendingApprovals } = trpc.team.pendingApprovals.useQuery(
    { department: "EXECUTION" },
    { enabled: isExecutionHead, staleTime: 60_000, refetchInterval: 60_000, retry: false },
  );

  const nav = [
    {
      href: "/execution",
      label: "Desk Overview",
      icon: <LayoutGrid className="h-4 w-4" />,
      exact: true,
    },
    {
      href: "/execution/open-trades",
      label: "Draft Trades",
      icon: <FileEdit className="h-4 w-4" />,
      badge:
        (summary?.openTrades ?? 0) > 0 ? (
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warning/15 px-1.5 text-[10px] font-bold text-warning">
            {summary?.openTrades}
          </span>
        ) : undefined,
    },
    {
      href: "/execution/contracts",
      label: "Reviewed Trades",
      icon: <ClipboardList className="h-4 w-4" />,
      badge:
        summary?.pendingWarehouseAllocation && summary.pendingWarehouseAllocation > 0 ? (
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent-secondary-muted px-1.5 text-[10px] font-bold text-accent-secondary">
            {summary.pendingWarehouseAllocation}
          </span>
        ) : undefined,
    },
    {
      label: "Operations",
      items: [
        { href: "/execution/prices", label: "Daily Prices", icon: <TrendingUp className="h-4 w-4" /> },
        { href: "/execution/inventory", label: "Inventory", icon: <Warehouse className="h-4 w-4" /> },
        { href: "/execution/positions", label: "Positions", icon: <LineChart className="h-4 w-4" /> },
        { href: "/execution/movements", label: "Truck Movements", icon: <Truck className="h-4 w-4" /> },
        { href: "/execution/shifting", label: "Internal Shifting", icon: <MoveRight className="h-4 w-4" /> },
        { href: "/execution/vouchers", label: "Vouchers", icon: <Receipt className="h-4 w-4" /> },
        { href: "/execution/ledgers", label: "Ledgers", icon: <BookOpen className="h-4 w-4" /> },
        { href: "/execution/rejections", label: "Rejections", icon: <XCircle className="h-4 w-4" /> },
        { href: "/execution/warehouses", label: "Warehouses", icon: <MapPin className="h-4 w-4" /> },
        ...(isExecutionHead
          ? [
              {
                href: "/execution/approvals",
                label: "Approvals",
                icon: <ShieldCheck className="h-4 w-4" />,
                badge:
                  pendingApprovals && pendingApprovals > 0 ? (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warning/15 px-1.5 text-[10px] font-bold text-warning">
                      {pendingApprovals}
                    </span>
                  ) : undefined,
              },
            ]
          : [
              {
                href: "/execution/approvals",
                label: "My requests",
                icon: <ClipboardCheck className="h-4 w-4" />,
              },
            ]),
        { href: "/execution/trade-files", label: "Trade Files", icon: <FileSpreadsheet className="h-4 w-4" /> },
      ],
    },
  ];

  return (
    <AppShell
      brandSubtitle="Execution Desk"
      pathname={pathname}
      nav={nav}
      sidebarTop={
        summary ? (
          <div className="mx-4 mb-2 mt-3 grid grid-cols-3 gap-1.5 rounded-xl border border-border bg-foreground/[0.03] p-2">
            <MiniStat label="Open" value={summary.lockedOpen} />
            <MiniStat label="Today" value={summary.vehiclesToday} />
            <MiniStat label="Pending" value={summary.pendingFinance} warn />
          </div>
        ) : null
      }
      header={
        <ShellHeader
          left={new Date().toLocaleDateString("en-PK", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
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
        warn && value > 0 && "bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)]",
      )}
    >
      <span
        className={cn(
          "text-base font-bold tabular-nums",
          warn && value > 0 ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-subtle">{label}</span>
    </div>
  );
}

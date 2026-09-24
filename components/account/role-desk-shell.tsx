"use client";

import type { Role } from "@prisma/client";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { CeoShell } from "@/components/layout/ceo-shell";
import { CommodityDeskProvider } from "@/components/trader/commodity-desk-provider";
import { TraderShell } from "@/components/layout/trader-shell";
import { ExecutionShell } from "@/components/layout/execution-shell";
import { DashboardShell } from "@/components/layout/dashboard-shell";

/** Wraps /account in the same desk shell as the user's role workspace. */
export function RoleDeskShell({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const role = session?.user?.role as Role | undefined;

  if (status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  switch (role) {
    case "CEO":
      return <CeoShell>{children}</CeoShell>;
    case "TRADER":
      return (
        <CommodityDeskProvider>
          <TraderShell>{children}</TraderShell>
        </CommodityDeskProvider>
      );
    case "EXECUTION":
      return <ExecutionShell>{children}</ExecutionShell>;
    case "FINANCE":
    case "RISK_MANAGER":
    case "READ_ONLY":
    case "ADMIN":
      return <DashboardShell>{children}</DashboardShell>;
    default:
      return <DashboardShell>{children}</DashboardShell>;
  }
}

"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ShellHeader } from "@/components/layout/shell-header";
import { trpc } from "@/lib/trpc/client";

const nav = [
  { href: "/ceo", label: "Overview", exact: true },
  { href: "/ceo/commodities", label: "Commodities" },
  { href: "/ceo/approvals", label: "Approvals" },
  { href: "/ceo/rejections", label: "Rejections" },
  { href: "/ceo/users", label: "Users" },
];

export function CeoShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pending = trpc.ceo.pendingApprovals.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const clearWithoutPayment = trpc.ceo.clearWithoutPaymentCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const overDelivery = trpc.ceo.overDeliveryCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const tradeSettlements = trpc.ceo.tradeSettlementCount.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  const active = trpc.ceo.activeUsers.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });

  const approvalsCount =
    (pending.data ?? 0) +
    (clearWithoutPayment.data ?? 0) +
    (overDelivery.data ?? 0) +
    (tradeSettlements.data ?? 0);

  const appNav = nav.map((item) => ({
    ...item,
    badge:
      item.href === "/ceo/approvals" && approvalsCount
        ? (
            <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-bold text-warning">
              {approvalsCount}
            </span>
          )
        : item.href === "/ceo/users" && active.data
          ? (
              <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-bold text-success">
                {active.data.count}
              </span>
            )
          : undefined,
  }));

  return (
    <AppShell
      brandSubtitle="Executive Office"
      pathname={pathname}
      nav={appNav}
      header={
        <ShellHeader
          left={new Date().toLocaleString("en-PK", {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            day: "numeric",
            month: "short",
          })}
        />
      }
    >
      {children}
    </AppShell>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
export function ReportTabs({ section }: { section: "pnl" | "reports" }) {
  const pathname = usePathname();
  const tabs = section === "pnl"
    ? [{ href: "/pnl", label: "P&L explained" }, { href: "/pnl/commercial-margins", label: "Commercial margins" }]
    : [{ href: "/reports", label: "Reports hub" }, { href: "/reports/commodity-sales", label: "Commodity sales" }];
  return <nav aria-label={section === "pnl" ? "P&L views" : "Reports"} className="mb-5 flex flex-wrap gap-2">{tabs.map((t) => <Link key={t.href} href={t.href} aria-current={pathname === t.href ? "page" : undefined} className={cn("rounded-lg border px-4 py-2 text-sm", pathname === t.href ? "border-brand bg-brand/10" : "border-border text-subtle")}>{t.label}</Link>)}</nav>;
}

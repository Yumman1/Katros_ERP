"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TRADE_SCOPE_LABELS,
  tradeScopeFromPathSegment,
  tradeScopeToPathSegment,
  type TradeScope,
} from "@/lib/trade-constants";
import { cn } from "@/lib/utils";

type Props = {
  scope: TradeScope;
  workflow: "purchase-delivered" | "purchase-spot" | "sales";
  title: string;
  subtitle: string;
};

export function TradeScopeHeader({ scope, workflow, title, subtitle }: Props) {
  const pathname = usePathname();

  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-medium text-subtle">
        <Link href="/execution" className="hover:text-foreground">
          Desk
        </Link>
        <span>/</span>
        <span className="text-muted-foreground">{TRADE_SCOPE_LABELS[scope]}</span>
        <span>/</span>
        <span className="text-muted-foreground">{title}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="kastros-page-title">
            {TRADE_SCOPE_LABELS[scope]} — {title}
          </h1>
          <p className="kastros-page-subtitle">{subtitle}</p>
        </div>
        <div className="exec-segment">
          {(["LOCAL", "INTERNATIONAL"] as TradeScope[]).map((s) => {
            const href = `/execution/${tradeScopeToPathSegment(s)}/${workflow}`;
            const active =
              tradeScopeFromPathSegment(pathname.split("/")[2] ?? "") === s || scope === s;
            return (
              <Link
                key={s}
                href={href}
                className={cn("exec-segment-item", active && "exec-segment-active")}
              >
                {TRADE_SCOPE_LABELS[s]}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

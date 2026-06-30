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
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
        <Link href="/execution" className="hover:text-white">
          Desk
        </Link>
        <span>/</span>
        <span className="text-zinc-400">{TRADE_SCOPE_LABELS[scope]}</span>
        <span>/</span>
        <span className="text-zinc-400">{title}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {TRADE_SCOPE_LABELS[scope]} — {title}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
        </div>
        <div className="flex rounded-xl p-1" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          {(["LOCAL", "INTERNATIONAL"] as TradeScope[]).map((s) => {
            const href = `/execution/${tradeScopeToPathSegment(s)}/${workflow}`;
            const active = tradeScopeFromPathSegment(pathname.split("/")[2] ?? "") === s || scope === s;
            return (
              <Link
                key={s}
                href={href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  active ? "text-amber-400" : "text-zinc-500 hover:text-white",
                )}
                style={
                  active
                    ? { background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)" }
                    : undefined
                }
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

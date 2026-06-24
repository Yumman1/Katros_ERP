"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PriceTicker } from "@/components/modules/price-ticker";

const nav = [
  { href: "/trader", label: "My Desk", icon: "◉" },
  { href: "/trader/trades", label: "My Trades", icon: "☰" },
  { href: "/trader/positions", label: "My Book", icon: "▤" },
  { href: "/trader/market", label: "Market", icon: "◈" },
];

export function TraderShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const firstName = session?.user?.name?.split(" ")[0] ?? "Trader";

  return (
    <div className="flex min-h-screen bg-kastros-bg">
      <aside className="fixed left-0 top-0 z-40 flex h-full w-[220px] flex-col border-r border-kastros-border bg-kastros-card">
        <div className="border-b border-kastros-border px-4 py-4">
          <div className="text-lg font-semibold tracking-tight text-white">Kastros</div>
          <div className="text-xs text-kastros-green">Trading Desk</div>
        </div>

        <div className="p-3">
          <Link
            href="/trader/trades/new"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-kastros-green py-2.5 text-sm font-semibold text-kastros-bg hover:opacity-90"
          >
            + Book Trade
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 text-sm">
          {nav.map((item) => {
            const active =
              item.href === "/trader"
                ? pathname === "/trader"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-2 text-zinc-300 hover:bg-white/5 hover:text-white",
                  active && "bg-white/10 text-kastros-green",
                )}
              >
                <span className="text-xs opacity-60">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-kastros-border p-3 text-xs text-zinc-500">
          <div className="text-zinc-300">{session?.user?.name}</div>
          <div className="mt-0.5">{session?.user?.email}</div>
          <div className="mt-2 rounded bg-kastros-border px-2 py-0.5 inline-block text-kastros-green">
            {session?.user?.role}
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col pl-[220px]">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-4 border-b border-kastros-border bg-kastros-bg/95 px-4 backdrop-blur">
          <div className="text-sm font-medium text-white">
            Good {getGreeting()}, {firstName}
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <PriceTicker />
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-md border border-kastros-border px-2 py-1 text-xs text-zinc-300 hover:bg-white/5"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

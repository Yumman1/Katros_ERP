"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { KastrosLogo } from "@/components/branding/kastros-logo";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH = "w-[248px]";
const SIDEBAR_PL = "pl-[248px]";

type NavLink = {
  href: string;
  label: string;
  icon?: ReactNode;
  exact?: boolean;
  badge?: ReactNode;
};

type NavGroup = {
  label: string;
  items: NavLink[];
};

type Props = {
  brandSubtitle: string;
  sidebarTop?: ReactNode;
  nav: (NavLink | NavGroup)[];
  pathname: string;
  children: ReactNode;
  header: ReactNode;
};

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname.startsWith(href);
}

export function AppShell({ brandSubtitle, sidebarTop, nav, pathname, children, header }: Props) {
  const renderLink = (item: NavLink) => {
    const active = isActive(pathname, item.href, item.exact);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn("kastros-nav-link relative", active && "kastros-nav-link-active")}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" />
        )}
        {item.icon ? (
          <span className={cn("flex-shrink-0", active ? "text-brand" : "text-muted-foreground")}>
            {item.icon}
          </span>
        ) : null}
        <span className="leading-tight">{item.label}</span>
        {item.badge ? <span className="ml-auto">{item.badge}</span> : null}
      </Link>
    );
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-dvh flex-col border-r border-border bg-sidebar",
          SIDEBAR_WIDTH,
        )}
      >
        <div className="kastros-brand-bar px-4 py-5">
          <KastrosLogo variant="full-white" size="md" subtitle={brandSubtitle} />
        </div>

        {sidebarTop}

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {nav.map((entry) =>
            "items" in entry ? (
              <div key={entry.label} className="pt-2">
                <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {entry.label}
                </div>
                <div className="space-y-0.5">{entry.items.map(renderLink)}</div>
              </div>
            ) : (
              renderLink(entry)
            ),
          )}
        </nav>
      </aside>

      <div className={cn("flex h-dvh min-h-0 flex-1 flex-col overflow-hidden", SIDEBAR_PL)}>
        {header}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
          <div className="kastros-desk-host mx-auto max-w-7xl">
            <div className="kastros-desk-host-scroll">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}

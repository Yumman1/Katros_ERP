"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

type Props = {
  left?: ReactNode;
  center?: ReactNode;
  className?: string;
};

export function ShellHeader({ left, center, className }: Props) {
  const { data: session } = useSession();

  return (
    <header
      className={cn(
        "z-30 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-header px-4",
        className,
      )}
    >
      {left ? <div className="shrink-0 text-sm font-medium text-muted-foreground">{left}</div> : null}
      {center ? <div className="min-w-0 flex-1 overflow-hidden">{center}</div> : <div className="flex-1" />}
      <div className="flex items-center gap-2 text-sm">
        {session?.user?.email ? (
          <span className="hidden max-w-[180px] truncate text-muted-foreground md:inline">
            {session.user.email}
          </span>
        ) : null}
        {session?.user?.role ? (
          <span className="rounded-md bg-brand-muted px-2 py-0.5 text-xs font-medium text-brand">
            {session.user.role}
          </span>
        ) : null}
        {session?.user?.isHead ? (
          <span className="rounded-md bg-green-muted px-2 py-0.5 text-xs font-semibold text-accent-secondary">
            Head
          </span>
        ) : null}
        <ThemeToggle compact />
        <Link href="/account" className="kastros-btn-secondary px-3 py-1.5 text-xs">
          Account
        </Link>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="kastros-btn-secondary px-3 py-1.5 text-xs"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

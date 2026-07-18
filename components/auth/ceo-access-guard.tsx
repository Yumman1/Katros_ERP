"use client";

import { getHomeForRole } from "@/lib/routing";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

export function CeoAccessGuard({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "authenticated" || !session?.user) return;
    const role = session.user.role;
    if (role !== "CEO" && role !== "ADMIN") {
      router.replace(getHomeForRole(role));
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-subtle">
        Loading executive desk…
      </div>
    );
  }

  if (status === "unauthenticated" || !session?.user) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-subtle">
        Redirecting to sign in…
      </div>
    );
  }

  if (session.user.role !== "CEO" && session.user.role !== "ADMIN") {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
        Executive overview is only available to the CEO account.
      </div>
    );
  }

  return children;
}

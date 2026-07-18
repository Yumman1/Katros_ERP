"use client";

import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const PUBLIC_PATHS = ["/login", "/warehouse/gatepass", "/"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
}

export function AuthBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return children;
  return <AuthGuard>{children}</AuthGuard>;
}

const SESSION_TIMEOUT_MS = 5000;

function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (status !== "loading") {
      setTimedOut(false);
      return;
    }
    const id = window.setTimeout(() => setTimedOut(true), SESSION_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [status, pathname]);

  useEffect(() => {
    if (status === "unauthenticated") {
      const callback = encodeURIComponent(pathname);
      router.replace(`/login?callbackUrl=${callback}`);
      return;
    }
    if (status === "loading" && timedOut) {
      void signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(pathname)}` });
    }
  }, [status, timedOut, router, pathname]);

  // Middleware already authenticated the route — paint the app immediately while session hydrates.
  if (status === "loading" && timedOut) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Session timed out — redirecting to sign in…
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  return children;
}

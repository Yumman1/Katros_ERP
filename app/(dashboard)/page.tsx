"use client";

import { getHomeForRole } from "@/lib/routing";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function RootRedirectPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (session?.user?.role) {
      router.replace(getHomeForRole(session.user.role));
    }
  }, [status, session, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-zinc-500">
      Redirecting…
    </div>
  );
}

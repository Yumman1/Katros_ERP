"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { PageHeader } from "@/components/ui/page-header";
import { getHomeForRole } from "@/lib/routing";
import type { Role } from "@prisma/client";

export default function AccountPage() {
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;
  const home = role ? getHomeForRole(role) : "/login";

  return (
    <div className="kastros-desk-page">
      <PageHeader
        title="Account"
        subtitle="Update your login password. If you forgot it, ask the CEO to reset it from Users."
        actions={
          <Link href={home} className="kastros-btn-secondary text-xs">
            Back to desk
          </Link>
        }
      />

      <section className="rounded-xl border border-border bg-card px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Profile</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-subtle">Name</dt>
            <dd className="text-foreground">{session?.user?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-subtle">Email</dt>
            <dd className="text-foreground">{session?.user?.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-subtle">Role</dt>
            <dd className="text-foreground">{session?.user?.role ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Change password</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Enter your current password, then choose a new one (at least 8 characters).
        </p>
        <div className="mt-4">
          <ChangePasswordForm />
        </div>
      </section>
    </div>
  );
}

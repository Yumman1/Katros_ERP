"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ExecutionApprovalsTabs } from "@/components/execution/execution-approvals-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { canActOnDepartment } from "@/lib/departments";
import { useTeam } from "@/lib/use-team";

export default function ExecutionApprovalsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { role, isHead } = useTeam();
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");

  useEffect(() => {
    if (role != null && !isExecutionHead) {
      router.replace("/execution/my-approvals");
    }
  }, [role, isExecutionHead, router]);

  if (role != null && !isExecutionHead) {
    return null;
  }

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Team Approvals</span>
          </>
        }
        title="Team Approvals"
        subtitle="Review team change requests, delivery order approvals, and recorded rejections."
      />

      <ExecutionApprovalsTabs />

      {children}
    </div>
  );
}

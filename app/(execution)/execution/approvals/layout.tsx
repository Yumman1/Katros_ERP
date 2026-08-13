"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ExecutionApprovalsTabs } from "@/components/execution/execution-approvals-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { canActOnDepartment } from "@/lib/departments";
import { useTeam } from "@/lib/use-team";

export default function ExecutionApprovalsLayout({ children }: { children: ReactNode }) {
  const { role, isHead } = useTeam();
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">{isExecutionHead ? "Team Approvals" : "My Approvals"}</span>
          </>
        }
        title={isExecutionHead ? "Team Approvals" : "My Approvals"}
        subtitle={
          isExecutionHead
            ? "Team change requests, delivery order approvals, and rejections — all in one place."
            : "Track change requests you submitted and see rejections on the execution desk."
        }
      />

      <ExecutionApprovalsTabs />

      {children}
    </div>
  );
}

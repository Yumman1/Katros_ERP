"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ExecutionMyApprovalsTabs } from "@/components/execution/execution-my-approvals-tabs";
import { PageHeader } from "@/components/ui/page-header";

export default function ExecutionMyApprovalsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">My Approvals</span>
          </>
        }
        title="My Approvals"
        subtitle="Requests you submitted — track CEO approvals and rejections on your own submissions."
      />

      <ExecutionMyApprovalsTabs />

      {children}
    </div>
  );
}

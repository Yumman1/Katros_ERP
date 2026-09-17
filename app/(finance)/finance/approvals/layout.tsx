import type { ReactNode } from "react";
import { FinanceApprovalsTabs } from "@/components/finance/approvals-tabs";

export default function Layout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"><div className="shrink-0"><FinanceApprovalsTabs /></div><div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div></div>;
}

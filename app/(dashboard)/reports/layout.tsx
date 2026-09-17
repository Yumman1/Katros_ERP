import type { ReactNode } from "react";
import { ReportTabs } from "@/components/reports/report-tabs";
export default function Layout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><div className="shrink-0"><ReportTabs section="reports" /></div><div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div></div>;
}

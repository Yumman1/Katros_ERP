import { DashboardShell } from "@/components/layout/dashboard-shell";

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}

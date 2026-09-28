import { ExecutionCommodityDeskProvider } from "@/components/execution/commodity-desk-provider";
import { ExecutionShell } from "@/components/layout/execution-shell";

export default function ExecutionLayout({ children }: { children: React.ReactNode }) {
  return <ExecutionCommodityDeskProvider><ExecutionShell>{children}</ExecutionShell></ExecutionCommodityDeskProvider>;
}

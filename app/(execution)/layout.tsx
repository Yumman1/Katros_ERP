import { ExecutionShell } from "@/components/layout/execution-shell";

export default function ExecutionLayout({ children }: { children: React.ReactNode }) {
  return <ExecutionShell>{children}</ExecutionShell>;
}

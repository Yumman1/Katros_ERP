import { TraderShell } from "@/components/layout/trader-shell";

export default function TraderLayout({ children }: { children: React.ReactNode }) {
  return <TraderShell>{children}</TraderShell>;
}

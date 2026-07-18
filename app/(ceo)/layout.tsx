import { CeoShell } from "@/components/layout/ceo-shell";
import { CeoAccessGuard } from "@/components/auth/ceo-access-guard";

export default function CeoLayout({ children }: { children: React.ReactNode }) {
  return (
    <CeoShell>
      <CeoAccessGuard>{children}</CeoAccessGuard>
    </CeoShell>
  );
}

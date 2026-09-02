import { RoleDeskShell } from "@/components/account/role-desk-shell";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <RoleDeskShell>{children}</RoleDeskShell>;
}

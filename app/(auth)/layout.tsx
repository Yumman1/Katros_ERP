export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh overflow-auto">{children}</div>;
}

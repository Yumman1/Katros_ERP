/** Standalone warehouse pages (gatepass) — full viewport with internal scroll. */
export default function WarehouseLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh min-h-0 overflow-y-auto">{children}</div>;
}

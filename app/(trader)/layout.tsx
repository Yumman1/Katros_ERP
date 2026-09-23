import { CommodityDeskProvider } from "@/components/trader/commodity-desk-provider";
import { TraderShell } from "@/components/layout/trader-shell";

export default function TraderLayout({ children }: { children: React.ReactNode }) {
  return <CommodityDeskProvider><TraderShell>{children}</TraderShell></CommodityDeskProvider>;
}

import { notFound } from "next/navigation";
import { PurchaseSpotDesk } from "@/components/execution/purchase-spot-desk";
import { tradeScopeFromPathSegment } from "@/lib/trade-constants";

export default function ScopedPurchaseSpotPage({ params }: { params: { scope: string } }) {
  const scope = tradeScopeFromPathSegment(params.scope);
  if (!scope) notFound();
  return <PurchaseSpotDesk scope={scope} />;
}

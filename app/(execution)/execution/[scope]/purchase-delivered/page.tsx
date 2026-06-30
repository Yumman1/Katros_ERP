import { notFound } from "next/navigation";
import { PurchaseDeliveredDesk } from "@/components/execution/purchase-delivered-desk";
import { tradeScopeFromPathSegment } from "@/lib/trade-constants";

export default function ScopedPurchaseDeliveredPage({
  params,
}: {
  params: { scope: string };
}) {
  const scope = tradeScopeFromPathSegment(params.scope);
  if (!scope) notFound();
  return <PurchaseDeliveredDesk scope={scope} />;
}

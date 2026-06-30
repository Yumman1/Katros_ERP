import { notFound } from "next/navigation";
import { SalesDesk } from "@/components/execution/sales-desk";
import { tradeScopeFromPathSegment } from "@/lib/trade-constants";

export default function ScopedSalesPage({ params }: { params: { scope: string } }) {
  const scope = tradeScopeFromPathSegment(params.scope);
  if (!scope) notFound();
  return <SalesDesk scope={scope} />;
}

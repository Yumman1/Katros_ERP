"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { TradeContractPrintView } from "@/components/trade/trade-contract-print";

export default function TradeConfirmationPrintPage() {
  const params = useParams();
  const tradeRef = decodeURIComponent(params.ref as string);
  const { data: trade, isLoading, error } = trpc.trader.tradeByRef.useQuery({ tradeRef });

  return (
    <TradeContractPrintView
      trade={trade ?? undefined}
      isLoading={isLoading}
      error={error?.message}
      backHref={`/trader/trades/${encodeURIComponent(tradeRef)}`}
      backLabel="← Back to trade"
      secondaryHref="/trader/trades"
      secondaryLabel="My trades"
    />
  );
}

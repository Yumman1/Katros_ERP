"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { TradeContractPrintView } from "@/components/trade/trade-contract-print";
import { executionWorkspacePath, profileFromTrade } from "@/lib/execution-routes";

export default function ExecutionTradePrintPage() {
  const params = useParams();
  const tradeRef = decodeURIComponent(params.ref as string);
  const { data: trade, isLoading, error } = trpc.execution.tradeForPrint.useQuery({ tradeRef });

  const backHref = trade
    ? executionWorkspacePath(
        trade.tradeRef,
        profileFromTrade(trade.direction, trade.buyingCategory ?? undefined),
      )
    : "/execution/contracts";

  return (
    <TradeContractPrintView
      trade={trade ?? undefined}
      isLoading={isLoading}
      error={error?.message}
      backHref={backHref}
      backLabel="← Back to contract"
      secondaryHref="/execution/contracts"
      secondaryLabel="Reviewed trades"
    />
  );
}

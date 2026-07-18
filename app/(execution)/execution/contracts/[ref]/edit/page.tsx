"use client";

import { OpenTradeDetail } from "@/components/execution/open-trade-detail";
import { useParams } from "next/navigation";

export default function LockedContractEditPage() {
  const params = useParams();
  const tradeRef = decodeURIComponent(params.ref as string);
  return <OpenTradeDetail tradeRef={tradeRef} mode="locked" />;
}

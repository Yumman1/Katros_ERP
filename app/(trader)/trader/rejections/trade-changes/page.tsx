"use client";

import { RejectionsTable } from "@/components/trader/rejections-table";
import { REJECTION_TAB_KINDS } from "@/lib/rejection-kinds";

export default function TradeChangeRejectionsPage() {
  return (
    <RejectionsTable
      kinds={REJECTION_TAB_KINDS.tradeChanges}
      emptyMessage="No trade-change rejections. When the CEO turns down an edit, delete, close, or cancel request on one of your trades, it appears here with their reason."
    />
  );
}

"use client";

import { RejectionsTable } from "@/components/trader/rejections-table";
import { REJECTION_TAB_KINDS } from "@/lib/rejection-kinds";

export default function OverDeliveryRejectionsPage() {
  return (
    <RejectionsTable
      kinds={REJECTION_TAB_KINDS.overDelivery}
      emptyMessage="No over-delivery rejections. When you or the CEO turn down an over-delivery request, it appears here with the reason."
    />
  );
}

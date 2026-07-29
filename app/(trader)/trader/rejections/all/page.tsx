"use client";

import { RejectionsTable } from "@/components/trader/rejections-table";

export default function AllRejectionsPage() {
  return (
    <RejectionsTable emptyMessage="No rejections on your trades. When a request on one of your trades is turned down, it shows up here with the reason." />
  );
}

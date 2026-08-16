"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  DeliveryOrderDocument,
  DeliveryOrderPrintStyles,
} from "@/components/documents/delivery-order-document";
import { trpc } from "@/lib/trpc/client";

function deliveryOrderBackHref(role: string | undefined): {
  href: string;
  label: string;
} {
  if (role === "FINANCE" || role === "CEO") {
    return { href: "/finance/delivery-order-approvals", label: "Back to DO approvals" };
  }
  return { href: "/execution/movements", label: "Back to movements" };
}

export default function DeliveryOrderPrintPage() {
  const params = useParams();
  const truckId = params.truckId as string;
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const back = deliveryOrderBackHref(role);
  const { data, isLoading, error } = trpc.execution.saleTruckPrintable.useQuery({ truckId });

  return (
    <div className="min-h-screen bg-white text-black">
      <DeliveryOrderPrintStyles />

      <div className="no-print flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3">
        <Link href={back.href} className="text-sm font-medium text-black underline">
          ← {back.label}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!data?.deliveryOrderNo}
          className="ml-auto rounded-md bg-black px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Print
        </button>
      </div>

      <DeliveryOrderDocument
        data={data}
        isLoading={isLoading}
        error={error}
        className="my-6"
      />
    </div>
  );
}

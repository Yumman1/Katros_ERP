"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  GateOutSlipDocument,
  GateOutSlipPrintStyles,
} from "@/components/documents/gate-out-slip-document";
import { trpc } from "@/lib/trpc/client";

export default function GateOutSlipPrintPage() {
  const params = useParams();
  const truckId = params.truckId as string;
  const { data, isLoading, error } = trpc.execution.saleTruckPrintable.useQuery({ truckId });

  return (
    <div className="min-h-screen bg-white text-black">
      <GateOutSlipPrintStyles />

      <div className="no-print flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3">
        <Link href="/execution/movements" className="text-sm font-medium text-black underline">
          ← Back to movements
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!data?.gateOutSlipNo}
          className="ml-auto rounded-md bg-black px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Print
        </button>
      </div>

      {isLoading && <p className="p-8 text-sm text-neutral-600">Loading gate out slip…</p>}
      {error && <p className="p-8 text-sm text-red-700">{error.message}</p>}

      {data && !data.gateOutSlipNo && (
        <div className="mx-auto max-w-[720px] p-10 text-center">
          <p className="text-base font-semibold">Not released yet</p>
          <p className="mt-1 text-sm text-neutral-600">
            Generate the gate pass from the truck workflow after delivery order approval.
          </p>
        </div>
      )}

      {data?.gateOutSlipNo && <GateOutSlipDocument data={data} className="my-6" />}
    </div>
  );
}

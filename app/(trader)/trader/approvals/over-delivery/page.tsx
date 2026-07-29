"use client";

import Link from "next/link";
import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Package, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

type OverDeliveryRow = {
  truckId: string;
  gatepassNo: string;
  truckNo: string;
  arrivalDate: Date | string;
  warehouseName: string;
  tradeRef: string;
  counterpartyName: string;
  commodityName: string;
  truckQtyMt: number;
  openQtyMt: number;
  toleranceMt: number;
  quantityUnit: string;
  traderName: string;
  overDeliveryTraderBy: string | null;
  stage: string;
};

const qtyFormat = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 3 });

function fmtQty(v: number, unit: string) {
  return `${qtyFormat.format(v)} ${unit}`;
}

export default function TraderOverDeliveryApprovalsPage() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.trader.overDeliveryApprovals.useQuery(undefined, {
    refetchInterval: 20_000,
  });

  const resolve = trpc.trader.resolveOverDeliveryApproval.useMutation({
    onSuccess: (_data, variables) => {
      void utils.trader.overDeliveryApprovals.invalidate();
      void utils.trader.overDeliveryApprovalsCount.invalidate();
      if (variables.decision === "REJECT") void utils.policy.rejections.invalidate();
    },
  });

  const items = rows ?? [];

  // Page shell, header and tabs come from the layout — this renders one tab.
  return (
      <div className="kastros-desk-scroll space-y-4 pb-6">
        <p className="text-xs text-subtle">
          Inbound trucks delivering more than a trade can absorb — your approval sends them to the
          CEO for final clearance.
        </p>
        {isLoading ? (
          <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
            Loading over-delivery requests…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-sm text-subtle">
            No over-delivery requests. When an inbound truck exceeds a trade&apos;s open quantity
            and tolerance, execution&apos;s request for your approval shows up here.
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((r) => (
              <OverDeliveryCard key={r.truckId} row={r} resolve={resolve} />
            ))}
          </div>
        )}
      </div>
  );
}

function OverDeliveryCard({
  row,
  resolve,
}: {
  row: OverDeliveryRow;
  resolve: ReturnType<typeof trpc.trader.resolveOverDeliveryApproval.useMutation>;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const busy = resolve.isPending && resolve.variables?.truckId === row.truckId;
  const errorHere = resolve.error && resolve.variables?.truckId === row.truckId;
  const overage = row.truckQtyMt - row.openQtyMt - row.toleranceMt;

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg font-semibold text-foreground">{row.gatepassNo}</span>
          <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-warning">
            Over-delivery
          </span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-subtle">Overage</div>
          <div className="tabular-nums text-lg font-bold text-destructive">
            {overage > 0 ? "+" : ""}
            {fmtQty(overage, row.quantityUnit)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <Detail label="Trade ref">
          <Link
            href={`/trader/trades/${encodeURIComponent(row.tradeRef)}`}
            className="font-mono text-accent-secondary hover:underline"
          >
            {row.tradeRef}
          </Link>
        </Detail>
        <Detail label="Counterparty">{row.counterpartyName}</Detail>
        <Detail label="Commodity">{row.commodityName}</Detail>
        <Detail label="Warehouse">{row.warehouseName}</Detail>
        <Detail label="Truck">{row.truckNo}</Detail>
        <Detail label="Arrival date">{format(new Date(row.arrivalDate), "dd MMM yyyy")}</Detail>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs">
        <Package className="h-4 w-4 shrink-0 text-warning" />
        <span className="text-muted-foreground">
          Truck{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {fmtQty(row.truckQtyMt, row.quantityUnit)}
          </span>{" "}
          vs trade open{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {fmtQty(row.openQtyMt, row.quantityUnit)}
          </span>{" "}
          (tolerance {fmtQty(row.toleranceMt, row.quantityUnit)}) — over by{" "}
          <span className="font-bold tabular-nums text-destructive">
            {fmtQty(overage, row.quantityUnit)}
          </span>
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve.mutate({ truckId: row.truckId, decision: "APPROVE" })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-xs font-bold text-white hover:bg-success/90 disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {busy && resolve.variables?.decision === "APPROVE" ? "Approving…" : "Approve → CEO"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRejectOpen((v) => !v)}
          className="kastros-btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
        >
          <XCircle className="h-3.5 w-3.5" />
          {rejectOpen ? "Cancel reject" : "Reject"}
        </button>
      </div>

      {rejectOpen && (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <label className="text-xs font-medium text-muted-foreground">
            Reason — shown on all dashboards
          </label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this over-delivery being rejected?"
            className="kastros-input mt-1 w-full"
          />
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() =>
              resolve.mutate({ truckId: row.truckId, decision: "REJECT", reason: reason.trim() })
            }
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-xs font-bold text-white hover:bg-destructive/90 disabled:opacity-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            {busy && resolve.variables?.decision === "REJECT" ? "Rejecting…" : "Reject request"}
          </button>
        </div>
      )}

      <p className="mt-3 flex items-start gap-2 text-xs text-subtle">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Approving forwards this truck to the CEO for the final over-delivery sign-off.
      </p>
      {errorHere && <p className="mt-2 text-xs text-destructive">{resolve.error?.message}</p>}
    </article>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

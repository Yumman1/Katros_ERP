"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Check, Handshake, Inbox, Package, Truck, X } from "lucide-react";
import { CeoApprovalsInbox } from "@/components/team/ceo-approvals-inbox";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export default function CeoApprovalsPage() {
  // One page, one scroll region. The queues used to sit as siblings, each
  // capped at 45dvh and unable to shrink, which squeezed the CEO queue to zero
  // height — pending approvals existed but were invisible.
  return (
    <div className="kastros-desk-page">
      <div className="kastros-desk-toolbar">
        <h1 className="text-2xl font-semibold text-foreground">Approvals</h1>
        <p className="mt-1 text-sm text-subtle">
          Final sign-off on trade closes and cancellations, warehouse and commodity registration,
          trader trade edits and deletions, over-deliveries, releases without payment, and direct
          settlements.
        </p>
      </div>

      <div className="kastros-desk-scroll flex flex-col gap-6 pb-6">
        <CeoApprovalsInbox />
        <OverDeliverySection />
        <ClearWithoutPaymentSection />
        <TradeSettlementSection />
      </div>
    </div>
  );
}

const qtyFormat = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 3 });

function fmtQty(value: number, unit: string): string {
  return `${qtyFormat.format(value)} ${unit}`;
}

function OverDeliverySection() {
  const utils = trpc.useUtils();
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const { data: rows } = trpc.ceo.overDeliveryApprovals.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  const resolve = trpc.ceo.resolveOverDelivery.useMutation({
    onSuccess: (_data, variables) => {
      void utils.ceo.overDeliveryApprovals.invalidate();
      void utils.ceo.overDeliveryCount.invalidate();
      if (variables.decision === "REJECT") void utils.policy.rejections.invalidate();
    },
  });

  const items = rows ?? [];

  return (
    <section className="rounded-xl border border-kastros-border bg-kastros-card">
      <div className="flex items-center justify-between border-b border-kastros-border px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Package className="h-4 w-4 text-brand" />
          Over-delivery approvals
        </div>
        <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
          {items.length} pending
        </span>
      </div>

      <div className="divide-y divide-kastros-border">
        {items.length === 0 && (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-subtle">
            <Inbox className="h-4 w-4" /> No over-delivery requests.
          </div>
        )}
        {items.map((r) => {
          const busy = resolve.isPending && resolve.variables?.truckId === r.truckId;
          const errorHere = resolve.error && resolve.variables?.truckId === r.truckId;
          const overage = r.truckQtyMt - r.openQtyMt - r.toleranceMt;
          return (
            <div key={r.truckId} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground">{r.gatepassNo}</span>
                    <span className="text-sm text-foreground">{r.truckNo}</span>
                    <span className="text-xs text-subtle">
                      {r.warehouseName} · Arrived {format(new Date(r.arrivalDate), "d MMM yyyy")}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    <span className="font-mono text-accent-secondary">{r.tradeRef}</span> · {r.counterpartyName} ·{" "}
                    {r.commodityName}
                  </div>
                  <div className="mt-1 text-xs text-accent-secondary">
                    Trader {r.overDeliveryTraderBy ?? r.traderName} approved
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Truck{" "}
                    <span className="font-semibold tabular-nums text-foreground">
                      {fmtQty(r.truckQtyMt, r.quantityUnit)}
                    </span>{" "}
                    vs trade open{" "}
                    <span className="font-semibold tabular-nums text-foreground">
                      {fmtQty(r.openQtyMt, r.quantityUnit)}
                    </span>{" "}
                    (tolerance {fmtQty(r.toleranceMt, r.quantityUnit)})
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-subtle">Overage</div>
                  <div className="text-sm font-bold tabular-nums text-destructive">
                    {overage > 0 ? "+" : ""}
                    {fmtQty(overage, r.quantityUnit)}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => resolve.mutate({ truckId: r.truckId, decision: "APPROVE" })}
                  className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {busy && resolve.variables?.decision === "APPROVE" ? "Approving…" : "Approve"}
                </button>
              </div>
              <div className="mt-2">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-subtle">
                  Reason — shown on all dashboards *
                </label>
                <div className="flex flex-wrap items-start gap-2">
                  <textarea
                    required
                    value={rejectReasons[r.truckId] ?? ""}
                    onChange={(e) => setRejectReasons((s) => ({ ...s, [r.truckId]: e.target.value }))}
                    placeholder="Why is this over-delivery rejected?"
                    rows={2}
                    className="kastros-input w-72 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy || !(rejectReasons[r.truckId] ?? "").trim()}
                    onClick={() =>
                      resolve.mutate({
                        truckId: r.truckId,
                        decision: "REJECT",
                        reason: rejectReasons[r.truckId].trim(),
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    {busy && resolve.variables?.decision === "REJECT" ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </div>
              {errorHere && <p className="mt-2 text-xs text-destructive">{resolve.error?.message}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TradeSettlementSection() {
  const utils = trpc.useUtils();
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const { data: rows } = trpc.ceo.tradeSettlements.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  const resolve = trpc.ceo.resolveTradeSettlement.useMutation({
    onSuccess: (_data, variables) => {
      void utils.ceo.tradeSettlements.invalidate();
      void utils.ceo.tradeSettlementCount.invalidate();
      if (variables.decision === "REJECT") void utils.policy.rejections.invalidate();
    },
  });

  const items = rows ?? [];

  return (
    <section className="rounded-xl border border-kastros-border bg-kastros-card">
      <div className="flex items-center justify-between border-b border-kastros-border px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Handshake className="h-4 w-4 text-brand" />
          Direct trade settlements
        </div>
        <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
          {items.length} pending
        </span>
      </div>

      <div className="divide-y divide-kastros-border">
        {items.length === 0 && (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-subtle">
            <Inbox className="h-4 w-4" /> No direct settlement requests.
          </div>
        )}
        {items.map((r) => {
          const busy = resolve.isPending && resolve.variables?.tradeRef === r.tradeRef;
          const errorHere = resolve.error && resolve.variables?.tradeRef === r.tradeRef;
          return (
            <div key={r.tradeRef} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-accent-secondary">{r.tradeRef}</span>
                    <span
                      className={cn(
                        "text-xs font-medium",
                        r.direction === "BUY" ? "text-success" : "text-destructive",
                      )}
                    >
                      {r.direction}
                    </span>
                    <span className="text-sm text-foreground">{r.commodityName}</span>
                    <span className="text-xs text-subtle">{r.commodityCode}</span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {r.counterpartyName} ·{" "}
                    <span className="tabular-nums text-foreground">{fmtQty(r.quantity, r.quantityUnit)}</span> ·{" "}
                    <span className="tabular-nums text-foreground">
                      {pkrFormat.format(r.notionalPkr)} {r.currency}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-accent-secondary">
                    Trader {r.traderName} requested
                    {r.requestedBy ? ` · ${r.requestedBy}` : ""}
                    {r.requestedAt ? ` · ${format(new Date(r.requestedAt), "d MMM yyyy HH:mm")}` : ""}
                  </div>
                  {r.note && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="text-subtle">Reason:</span> {r.note}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-warning">
                    Approving closes this trade with no delivery or gatepass.
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => resolve.mutate({ tradeRef: r.tradeRef, decision: "APPROVE" })}
                  className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {busy && resolve.variables?.decision === "APPROVE" ? "Approving…" : "Approve settlement"}
                </button>
              </div>
              <div className="mt-2">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-subtle">
                  Reason — shown on all dashboards *
                </label>
                <div className="flex flex-wrap items-start gap-2">
                  <textarea
                    required
                    value={rejectReasons[r.tradeRef] ?? ""}
                    onChange={(e) => setRejectReasons((s) => ({ ...s, [r.tradeRef]: e.target.value }))}
                    placeholder="Why is this direct settlement rejected?"
                    rows={2}
                    className="kastros-input w-72 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy || !(rejectReasons[r.tradeRef] ?? "").trim()}
                    onClick={() =>
                      resolve.mutate({
                        tradeRef: r.tradeRef,
                        decision: "REJECT",
                        reason: rejectReasons[r.tradeRef].trim(),
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    {busy && resolve.variables?.decision === "REJECT" ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </div>
              {errorHere && <p className="mt-2 text-xs text-destructive">{resolve.error?.message}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const pkrFormat = new Intl.NumberFormat("en-PK");

function fmtPkr(value: number): string {
  return `${pkrFormat.format(value)} PKR`;
}

function ClearWithoutPaymentSection() {
  const utils = trpc.useUtils();
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const { data: rows } = trpc.ceo.clearWithoutPaymentApprovals.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 60_000,
  });

  const resolve = trpc.ceo.resolveClearWithoutPayment.useMutation({
    onSuccess: (_data, variables) => {
      void utils.ceo.clearWithoutPaymentApprovals.invalidate();
      void utils.ceo.clearWithoutPaymentCount.invalidate();
      if (variables.decision === "REJECT") void utils.policy.rejections.invalidate();
    },
  });

  const items = rows ?? [];

  return (
    <section className="rounded-xl border border-kastros-border bg-kastros-card">
      <div className="flex items-center justify-between border-b border-kastros-border px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Truck className="h-4 w-4 text-brand" />
          Clear without payment
        </div>
        <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
          {items.length} pending
        </span>
      </div>

      <div className="divide-y divide-kastros-border">
        {items.length === 0 && (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-subtle">
            <Inbox className="h-4 w-4" /> No release-without-payment requests.
          </div>
        )}
        {items.map((r) => {
          const busy = resolve.isPending && resolve.variables?.truckId === r.truckId;
          const errorHere = resolve.error && resolve.variables?.truckId === r.truckId;
          return (
            <div key={r.truckId} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground">{r.gatepassNo}</span>
                    <span className="text-sm text-foreground">{r.truckNo}</span>
                    <span className="text-xs text-subtle">
                      {r.warehouseName} · Arrived {format(new Date(r.arrivalDate), "d MMM yyyy")}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    <span className="font-mono text-accent-secondary">{r.tradeRef}</span> · {r.counterpartyName} ·{" "}
                    {r.commodityName}
                  </div>
                  <div className="mt-1 text-xs text-accent-secondary">
                    Trader {r.traderName} approved
                    {r.saleTraderApprovedBy ? ` · ${r.saleTraderApprovedBy}` : ""}
                  </div>
                  <p className="mt-1 text-xs text-warning">
                    Releasing without payment leaves the receivable open in the buyer&apos;s ledger.
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 text-right">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">Total receivable</div>
                    <div className="text-sm font-bold tabular-nums text-foreground">
                      {fmtPkr(r.saleExpectedPkr)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle">Buyer balance</div>
                    <div
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        r.buyerBalancePkr >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {fmtPkr(r.buyerBalancePkr)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => resolve.mutate({ truckId: r.truckId, decision: "APPROVE" })}
                  className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {busy && resolve.variables?.decision === "APPROVE" ? "Approving…" : "Approve release"}
                </button>
              </div>
              <div className="mt-2">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-subtle">
                  Reason — shown on all dashboards *
                </label>
                <div className="flex flex-wrap items-start gap-2">
                  <textarea
                    required
                    value={rejectReasons[r.truckId] ?? ""}
                    onChange={(e) => setRejectReasons((s) => ({ ...s, [r.truckId]: e.target.value }))}
                    placeholder="Why is this release rejected?"
                    rows={2}
                    className="kastros-input w-72 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy || !(rejectReasons[r.truckId] ?? "").trim()}
                    onClick={() =>
                      resolve.mutate({
                        truckId: r.truckId,
                        decision: "REJECT",
                        reason: rejectReasons[r.truckId].trim(),
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                    {busy && resolve.variables?.decision === "REJECT" ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </div>
              {errorHere && <p className="mt-2 text-xs text-destructive">{resolve.error?.message}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

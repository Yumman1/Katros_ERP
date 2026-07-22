"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AGING_BUCKETS, AGING_BUCKET_LABELS, type AgingBucket } from "@/lib/finance-policy";
import { cn } from "@/lib/utils";

export type LedgerEntryRow = {
  id: string;
  entryDate: Date;
  entryType: "DEBIT" | "CREDIT";
  amountPkr: number;
  sourceType: "GATEPASS" | "VOUCHER" | "ADJUSTMENT";
  sourceRef: string | null;
  tradeRef: string | null;
  truckId: string | null;
  voucherNo: string | null;
  dueDate: Date | null;
  agingBucket: string | null;
  saleStage: string | null;
  note: string | null;
};

export type LedgerRow = {
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  totalDebitPkr: number;
  totalCreditPkr: number;
  /** credit − debit; negative = the buyer owes us. */
  balancePkr: number;
  availableCreditPkr: number;
  /** Open (unsettled) receivables by aging bucket. */
  aging: Record<AgingBucket, number>;
  entries: LedgerEntryRow[];
};

const pkrFormat = new Intl.NumberFormat("en-PK");

function fmtPkr(value: number): string {
  return `${pkrFormat.format(value)} PKR`;
}

function fmtDate(d: Date | string): string {
  return format(new Date(d), "d MMM yyyy");
}

/** PAYMENT_RECEIVED → "Payment received". */
function humanizeStage(stage: string | null): string {
  if (!stage) return "—";
  const words = stage.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function agingCellTone(bucket: AgingBucket, amount: number): string {
  if (amount <= 0) return "border-border bg-foreground/[0.03] text-subtle";
  if (bucket === "90+") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (bucket === "31-60" || bucket === "61-90") {
    return "border-warning/30 bg-warning/10 text-warning";
  }
  return "border-border bg-foreground/[0.03] text-foreground";
}

export function CounterpartyLedgersPanel({
  rows,
  isLoading,
}: {
  rows: LedgerRow[] | undefined;
  isLoading?: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const totals = useMemo(() => {
    const debit = (rows ?? []).reduce((s, r) => s + r.totalDebitPkr, 0);
    const credit = (rows ?? []).reduce((s, r) => s + r.totalCreditPkr, 0);
    return { debit, credit, balance: credit - debit };
  }, [rows]);

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-subtle">Loading counterparty ledgers…</div>;
  }

  if (!rows?.length) {
    return <div className="exec-empty">No sell-side counterparties registered yet.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCell label="Total debit" value={fmtPkr(totals.debit)} tone="text-destructive" />
        <SummaryCell label="Total credit" value={fmtPkr(totals.credit)} tone="text-success" />
        <SummaryCell
          label="Net balance"
          value={fmtPkr(totals.balance)}
          tone={totals.balance >= 0 ? "text-success" : "text-destructive"}
        />
      </div>

      {rows.map((r) => {
        const open = !!expanded[r.counterpartyId];
        return (
          <section key={r.counterpartyId} className="exec-panel">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{r.counterpartyName}</h3>
                <span className="rounded-full border border-border bg-foreground/[0.05] px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
                  {r.counterpartyCode}
                </span>
              </div>
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 text-right">
                <Metric label="Debit" value={fmtPkr(r.totalDebitPkr)} tone="text-destructive" />
                <Metric label="Credit" value={fmtPkr(r.totalCreditPkr)} tone="text-success" />
                <Metric
                  label="Balance"
                  value={fmtPkr(r.balancePkr)}
                  tone={r.balancePkr >= 0 ? "text-success" : "text-destructive"}
                />
                <Metric label="Available credit" value={fmtPkr(r.availableCreditPkr)} tone="text-foreground" />
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-5">
              {AGING_BUCKETS.map((bucket) => (
                <div
                  key={bucket}
                  className={cn("rounded-lg border px-2.5 py-1.5", agingCellTone(bucket, r.aging[bucket]))}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                    {AGING_BUCKET_LABELS[bucket]}
                  </div>
                  <div className="mt-0.5 truncate text-xs font-bold tabular-nums">{fmtPkr(r.aging[bucket])}</div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setExpanded((e) => ({ ...e, [r.counterpartyId]: !open }))}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent-secondary hover:underline"
            >
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {open ? "Hide entries" : "View entries"}
              <span className="text-subtle">({r.entries.length})</span>
            </button>

            {open && (
              <div className="kastros-table-wrap mt-3">
                {r.entries.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-subtle">No ledger entries yet.</div>
                ) : (
                  <table className="kastros-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th className="text-right">Amount</th>
                        <th>Source</th>
                        <th>Trade</th>
                        <th>Due date</th>
                        <th>Aging</th>
                        <th>Status</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.entries.map((e) => (
                        <tr key={e.id}>
                          <td className="whitespace-nowrap">{fmtDate(e.entryDate)}</td>
                          <td>
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                e.entryType === "DEBIT"
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-success/15 text-success",
                              )}
                            >
                              {e.entryType}
                            </span>
                          </td>
                          <td className="whitespace-nowrap text-right tabular-nums">{fmtPkr(e.amountPkr)}</td>
                          <td className="whitespace-nowrap">
                            <span className="font-mono text-xs">{e.sourceRef ?? e.voucherNo ?? "—"}</span>
                            <span className="ml-1.5 text-[10px] uppercase tracking-wider text-subtle">
                              {e.sourceType}
                            </span>
                          </td>
                          <td className="whitespace-nowrap font-mono text-xs">{e.tradeRef ?? "—"}</td>
                          <td className="whitespace-nowrap">{e.dueDate ? fmtDate(e.dueDate) : "—"}</td>
                          <td className="whitespace-nowrap">
                            {e.agingBucket && e.agingBucket in AGING_BUCKET_LABELS
                              ? AGING_BUCKET_LABELS[e.agingBucket as AgingBucket]
                              : "—"}
                          </td>
                          <td className="whitespace-nowrap">{humanizeStage(e.saleStage)}</td>
                          <td className="max-w-[220px] truncate text-muted-foreground" title={e.note ?? undefined}>
                            {e.note ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SummaryCell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="exec-panel">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { AGING_BUCKETS, AGING_BUCKET_LABELS, type AgingBucket } from "@/lib/finance-policy";
import { cn } from "@/lib/utils";

export type LedgerEntryRow = {
  id: string;
  entryDate: Date;
  entryType: "DEBIT" | "CREDIT";
  amountPkr: number;
  sourceType: "GATEPASS" | "VOUCHER" | "PAYMENT" | "ADJUSTMENT" | "INVOICE";
  sourceRef: string | null;
  tradeRef: string | null;
  truckId: string | null;
  voucherNo: string | null;
  dueDate: Date | null;
  agingBucket: string | null;
  saleStage: string | null;
  /** Settlement-invoice debits: collection status of that invoice. */
  settlementStatus?: string | null;
  /** DEBIT rows whose money has already moved — not outstanding. */
  settled?: boolean;
  /** DEBIT rows: how much of this entry has actually been paid. */
  paidPkr?: number;
  /** Buy debits the trader is deliberately holding — held money never ages. */
  held?: boolean;
  note: string | null;
};

/** One ledger ACCOUNT — a counterparty side. BUY and SELL never mix. */
export type LedgerRow = {
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  /** SELL = receivables from buyers, BUY = payables to sellers. */
  side: "BUY" | "SELL";
  /** Display account id, e.g. "CP-00101-S". */
  ledgerAccountId: string;
  totalDebitPkr: number;
  totalCreditPkr: number;
  /** Debits whose money has already moved (buy: receipt PAID; sell: truck paid). */
  settledDebitPkr: number;
  /** Debits still owed on this account. */
  outstandingDebitPkr: number;
  /** credit − debit; negative = money outstanding on this account. */
  balancePkr: number;
  /** SELL only — credit available for settling trucks; 0 for BUY. */
  availableCreditPkr: number;
  /** Open (unsettled) debits by aging bucket. */
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

const STAGE_LABELS: Record<string, string> = {
  CLEARED_UNPAID: "Released unpaid",
  SETTLED: "Settled",
  PAYMENT_RECEIVED: "Payment received",
};

/** CLEARED_UNPAID → "Released unpaid", PENDING_TRADER → "Pending trader". */
function humanizeStage(stage: string | null): string {
  if (!stage) return "—";
  if (STAGE_LABELS[stage]) return STAGE_LABELS[stage];
  const words = stage.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SOURCE_LABELS: Record<LedgerEntryRow["sourceType"], string> = {
  GATEPASS: "Gatepass",
  VOUCHER: "Voucher",
  PAYMENT: "Payment",
  ADJUSTMENT: "Adjustment",
  // Receivable on a settled trade — raised by invoice, since no truck runs.
  INVOICE: "Settlement",
};

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
  onSettle,
  settlingTruckId,
}: {
  rows: LedgerRow[] | undefined;
  isLoading?: boolean;
  onSettle?: (truckId: string) => void;
  settlingTruckId?: string | null;
}): JSX.Element {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sellRows = useMemo(() => (rows ?? []).filter((r) => r.side === "SELL"), [rows]);
  const buyRows = useMemo(() => (rows ?? []).filter((r) => r.side === "BUY"), [rows]);

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-subtle">Loading counterparty ledgers…</div>;
  }

  if (!rows?.length) {
    return <div className="exec-empty">No counterparty ledger accounts yet.</div>;
  }

  return (
    <div className="space-y-8">
      <SideSection
        side="SELL"
        heading="Sell ledgers (receivables)"
        description="What buyers owe us — truck debits vs voucher credits."
        accounts={sellRows}
        expanded={expanded}
        setExpanded={setExpanded}
        onSettle={onSettle}
        settlingTruckId={settlingTruckId}
      />
      <SideSection
        side="BUY"
        heading="Buy ledgers (payables)"
        description="What we owe sellers — expected-invoice debits vs payment-out credits."
        accounts={buyRows}
        expanded={expanded}
        setExpanded={setExpanded}
        onSettle={onSettle}
        settlingTruckId={settlingTruckId}
      />
    </div>
  );
}

function SideSection({
  side,
  heading,
  description,
  accounts,
  expanded,
  setExpanded,
  onSettle,
  settlingTruckId,
}: {
  side: "BUY" | "SELL";
  heading: string;
  description: string;
  accounts: LedgerRow[];
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSettle?: (truckId: string) => void;
  settlingTruckId?: string | null;
}) {
  const totals = useMemo(() => {
    const debit = accounts.reduce((s, r) => s + r.totalDebitPkr, 0);
    const credit = accounts.reduce((s, r) => s + r.totalCreditPkr, 0);
    const available = accounts.reduce((s, r) => s + r.availableCreditPkr, 0);
    const settled = accounts.reduce((s, r) => s + r.settledDebitPkr, 0);
    const outstanding = accounts.reduce((s, r) => s + r.outstandingDebitPkr, 0);
    return { debit, credit, balance: credit - debit, available, settled, outstanding };
  }, [accounts]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>

      {/* Payables are settled by the payment process marking the receipt paid,
          not by a credit row — so the buy side is read as billed / paid / still
          owed rather than debit vs credit. */}
      {side === "BUY" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCell label="Total payable" value={fmtPkr(totals.debit)} tone="text-foreground" />
          <SummaryCell label="Paid" value={fmtPkr(totals.settled)} tone="text-success" />
          <SummaryCell
            label="Still to pay"
            value={fmtPkr(totals.outstanding)}
            tone={totals.outstanding > 0 ? "text-destructive" : "text-success"}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryCell label="Total debit" value={fmtPkr(totals.debit)} tone="text-destructive" />
          <SummaryCell label="Total credit" value={fmtPkr(totals.credit)} tone="text-success" />
          <SummaryCell
            label="Net balance"
            value={fmtPkr(totals.balance)}
            tone={totals.balance >= 0 ? "text-success" : "text-destructive"}
          />
          <SummaryCell label="Available credit" value={fmtPkr(totals.available)} tone="text-foreground" />
        </div>
      )}

      {side === "SELL" ? (
        <p className="text-xs text-muted-foreground">
          Credit-terms trades release within their trade ceiling (balance may run negative within credit
          days); advance trades need vouchers against the trade or direct advances.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          A purchase is settled when its receipt is marked paid through the payment process — paid
          payables stop aging and are not owed. This account never mixes with the sell ledger.
        </p>
      )}

      {accounts.length === 0 ? (
        <div className="exec-empty">
          {side === "SELL" ? "No sell-side ledger accounts yet." : "No buy-side ledger accounts yet."}
        </div>
      ) : (
        accounts.map((r) => (
          <AccountCard
            key={r.ledgerAccountId}
            account={r}
            open={!!expanded[r.ledgerAccountId]}
            onToggle={() =>
              setExpanded((e) => ({ ...e, [r.ledgerAccountId]: !e[r.ledgerAccountId] }))
            }
            onSettle={onSettle}
            settlingTruckId={settlingTruckId}
          />
        ))
      )}
    </section>
  );
}

function AccountCard({
  account: r,
  open,
  onToggle,
  onSettle,
  settlingTruckId,
}: {
  account: LedgerRow;
  open: boolean;
  onToggle: () => void;
  onSettle?: (truckId: string) => void;
  settlingTruckId?: string | null;
}) {
  const isSell = r.side === "SELL";
  return (
    <section className="exec-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{r.counterpartyName}</h3>
          <span className="rounded-full border border-border bg-foreground/[0.05] px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
            {r.counterpartyCode}
          </span>
          <span className="rounded-full border border-border bg-foreground/[0.05] px-2 py-0.5 font-mono text-[10px] font-bold text-accent-secondary">
            {r.ledgerAccountId}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
              isSell ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
            )}
          >
            {isSell ? "Sell · receivable" : "Buy · payable"}
          </span>
        </div>
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 text-right">
          {isSell ? (
            <>
              <Metric label="Debit" value={fmtPkr(r.totalDebitPkr)} tone="text-destructive" />
              <Metric label="Credit" value={fmtPkr(r.totalCreditPkr)} tone="text-success" />
              <Metric
                label="Balance"
                value={fmtPkr(r.balancePkr)}
                tone={r.balancePkr >= 0 ? "text-success" : "text-destructive"}
              />
              <Metric label="Available credit" value={fmtPkr(r.availableCreditPkr)} tone="text-foreground" />
            </>
          ) : (
            <>
              <Metric label="Payable" value={fmtPkr(r.totalDebitPkr)} tone="text-foreground" />
              <Metric label="Paid" value={fmtPkr(r.settledDebitPkr)} tone="text-success" />
              <Metric
                label="Still to pay"
                value={fmtPkr(r.outstandingDebitPkr)}
                tone={r.outstandingDebitPkr > 0 ? "text-destructive" : "text-success"}
              />
            </>
          )}
        </div>
      </div>

      {/* Receivables age; payables do not. A purchase is paid outright before
          the truck is released, so a buy debit is either paid or deliberately
          held — an aging strip on it would only ever read as overdue. */}
      {isSell && (
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
      )}

      <button
        type="button"
        onClick={onToggle}
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
                  {/* Payables carry neither — see the aging note above. */}
                  {isSell && <th>Due date</th>}
                  {isSell && <th>Aging</th>}
                  <th>Status</th>
                  <th>Note</th>
                  {onSettle && <th />}
                </tr>
              </thead>
              <tbody>
                {r.entries.map((e) => {
                  const settleable =
                    !!onSettle && e.entryType === "DEBIT" && e.saleStage === "CLEARED_UNPAID" && !!e.truckId;
                  const settling = settleable && settlingTruckId === e.truckId;
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap">{fmtDate(e.entryDate)}</td>
                      <td className="whitespace-nowrap">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                            e.entryType === "CREDIT"
                              ? "bg-success/15 text-success"
                              : e.settled
                                ? "bg-foreground/[0.06] text-subtle"
                                : "bg-destructive/15 text-destructive",
                          )}
                        >
                          {e.entryType}
                        </span>
                        {e.settled ? (
                          <span className="ml-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase text-success">
                            Paid
                          </span>
                        ) : e.paidPkr ? (
                          <span
                            className="ml-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warning"
                            title={`${fmtPkr(e.paidPkr)} paid, ${fmtPkr(e.amountPkr - e.paidPkr)} held`}
                          >
                            Part paid
                          </span>
                        ) : e.held ? (
                          <span className="ml-1.5 rounded-full bg-foreground/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase text-subtle">
                            Held
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums">{fmtPkr(e.amountPkr)}</td>
                      <td className="whitespace-nowrap">
                        <span className="text-[10px] uppercase tracking-wider text-subtle">
                          {SOURCE_LABELS[e.sourceType]}
                        </span>
                        <span className="ml-1.5 font-mono text-xs">{e.sourceRef ?? e.voucherNo ?? "—"}</span>
                      </td>
                      <td className="whitespace-nowrap font-mono text-xs">
                        {e.entryType === "CREDIT" ? (
                          e.tradeRef ? (
                            <span className="rounded-full border border-accent-secondary/30 bg-accent-secondary/10 px-2 py-0.5 text-[10px] font-bold text-accent-secondary">
                              Against {e.tradeRef}
                            </span>
                          ) : (
                            <span className="rounded-full border border-border bg-foreground/[0.05] px-2 py-0.5 text-[10px] font-semibold text-subtle">
                              Direct advance
                            </span>
                          )
                        ) : (
                          e.tradeRef ?? "—"
                        )}
                      </td>
                      {isSell && (
                        <td className="whitespace-nowrap">{e.dueDate ? fmtDate(e.dueDate) : "—"}</td>
                      )}
                      {isSell && (
                        <td className="whitespace-nowrap">
                          {e.agingBucket && e.agingBucket in AGING_BUCKET_LABELS
                            ? AGING_BUCKET_LABELS[e.agingBucket as AgingBucket]
                            : "—"}
                        </td>
                      )}
                      <td className="whitespace-nowrap">{humanizeStage(e.saleStage)}</td>
                      <td className="max-w-[220px] truncate text-muted-foreground" title={e.note ?? undefined}>
                        {e.note ?? "—"}
                      </td>
                      {onSettle && (
                        <td className="whitespace-nowrap text-right">
                          {settleable && (
                            <button
                              type="button"
                              disabled={settling}
                              title="Applies available credit against this truck"
                              onClick={() => onSettle(e.truckId!)}
                              className="kastros-btn-primary inline-flex items-center gap-1.5 !px-3 !py-1 text-xs disabled:opacity-50"
                            >
                              {settling && <Loader2 className="h-3 w-3 animate-spin" />}
                              {settling ? "Settling…" : "Settle"}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
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

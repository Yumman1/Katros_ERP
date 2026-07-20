"use client";

import { invalidateTradeFlowCaches } from "@/lib/invalidate-caches";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQtyWithUnit } from "@/lib/formatters/numbers";
import { GATE_INVOICE_STAGES, GATE_INVOICE_STAGE_LABELS, type GateInvoiceStage } from "@/lib/gate-invoice";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ClipboardList, Pencil } from "lucide-react";

export default function PurchaseDeliveredDetailPage() {
  const params = useParams();
  const tradeRef = decodeURIComponent(params.ref as string);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.execution.contractByRef.useQuery({ tradeRef });
  const { data: invoiceSummary } = trpc.execution.gateInvoiceSummary.useQuery({ tradeRef });
  const submitFinance = trpc.execution.submitInboundForFinance.useMutation({
    onSuccess: () => invalidateTradeFlowCaches(utils, tradeRef),
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-subtle">Loading contract…</div>;
  }

  if (!data?.contract) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <p className="text-sm text-muted-foreground">Contract not found or trade is not locked yet.</p>
        <Link href="/execution/purchase-delivered" className="mt-2 text-xs text-emerald-400 hover:underline">
          ← Purchase delivered queue
        </Link>
      </div>
    );
  }

  const c = data.contract;
  const unit = c.quantityUnit;
  const pct = c.contractualQtyMt > 0 ? Math.min(c.receivedQtyMt / c.contractualQtyMt, 1) : 0;
  const tol = c.qualityTolerances;

  const approvedPkr = invoiceSummary?.approvedPkr ?? 0;
  const totalTradeValuePkr = invoiceSummary?.totalTradeValuePkr ?? 0;
  const approvedPct = totalTradeValuePkr > 0 ? Math.min(approvedPkr / totalTradeValuePkr, 1) : 0;
  const invoices = invoiceSummary?.invoices ?? [];

  return (
    <div className="kastros-desk-page">
      <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
        <Link href="/execution" className="hover:text-foreground">Desk</Link>
        <span>/</span>
        <Link href="/execution/purchase-delivered" className="hover:text-foreground">Purchase (Delivered)</Link>
        <span>/</span>
        <span style={{ color: "#a1a1aa" }}>{tradeRef}</span>
      </div>

      <div className="rounded-2xl p-5" style={{ background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.12)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-xl font-bold" style={{ color: "#34d399" }}>{c.tradeRef}</h1>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {c.counterpartyName}
              {c.counterpartyNtn && (
                <span className="ml-2 text-xs" style={{ color: "#71717a" }}>NTN: {c.counterpartyNtn}</span>
              )}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
              {c.warehouseDefault ?? "Warehouse TBD"} · PKR {c.ratePerMaund?.toFixed(0) ?? "—"}/Maund
              {c.deliveryEnd && (
                <span className="ml-2">
                  · Due {new Date(c.deliveryEnd).toLocaleDateString("en-PK")}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatBadge label="Contract Qty" value={formatQtyWithUnit(c.contractualQtyMt, unit, 2)} />
            <StatBadge label="Received" value={formatQtyWithUnit(c.receivedQtyMt, unit, 2)} color="#34d399" />
            <StatBadge
              label="Open"
              value={formatQtyWithUnit(c.openQtyMt, unit, 2)}
              color={c.openQtyMt > 0 ? "#f59e0b" : "#6b7280"}
            />
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-[10px]" style={{ color: "#71717a" }}>
            <span>Fulfillment progress</span>
            <span>{(pct * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct * 100}%`, background: "linear-gradient(90deg,#34d399,#10b981)" }}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <QualBadge label="Moisture" value={`≤${tol.moisturePct}%`} />
          <QualBadge label="Damage" value={`≤${tol.damagePct}%`} />
          <QualBadge label="Broken" value={`≤${tol.brokenPct}%`} />
        </div>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
        style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}
      >
        <div>
          <p className="text-sm font-semibold text-warning">Trucks arrive via gatepass</p>
          <p className="mt-0.5 text-xs text-subtle">
            Warehouse staff log trucks on the public link. Assign them to this trade from the fulfillment queue.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/execution/purchase-delivered?cp=${encodeURIComponent(c.counterpartyName)}`}
            className="rounded-xl px-4 py-2 text-xs font-bold text-black"
            style={{ background: "linear-gradient(135deg,#34d399,#10b981)" }}
          >
            Assign trucks →
          </Link>
          <Link
            href="/warehouse/gatepass"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            style={{ borderColor: "rgba(255,255,255,0.1)" }}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Gatepass link
          </Link>
        </div>
      </div>

      <div className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-sm font-semibold text-foreground">Inbound history (from gatepass assignment)</h2>
          <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
            {data.inbound.length} vehicle{data.inbound.length !== 1 ? "s" : ""} linked to this contract
          </p>
        </div>
        {data.inbound.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-subtle">
            No trucks assigned yet. Use the fulfillment queue to match gatepass trucks to this trade.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            {data.inbound.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span className="font-mono font-semibold text-emerald-400">{r.gatepassNo ?? r.kcsNo}</span>
                  <span className="text-muted-foreground">🚛 {r.truckNo}</span>
                  {r.driverName && <span className="text-subtle">{r.driverName}</span>}
                  <span className="text-muted-foreground">{formatQtyWithUnit(r.allocatedQtyMt, unit, 3)}</span>
                  <span style={{ color: "#f59e0b" }}>{new Intl.NumberFormat("en-PK").format(r.amountDue)} PKR</span>
                  <StatusBadge status={r.status} />
                </div>
                {r.status === "ALLOCATED" && (
                  <button
                    type="button"
                    onClick={() => submitFinance.mutate({ receiptId: r.id })}
                    disabled={submitFinance.isPending}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold disabled:opacity-50"
                    style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}
                  >
                    Submit to Finance
                  </button>
                )}
                {r.status === "FINANCE_PENDING" && (
                  <span
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold"
                    style={{ background: "rgba(96,165,250,0.1)", color: "#60a5fa" }}
                  >
                    Awaiting finance
                  </span>
                )}
                {r.status === "PAID" && (
                  <span
                    className="rounded-lg px-3 py-1.5 text-[11px] font-bold"
                    style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}
                  >
                    ✓ Paid
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Gate invoices</h2>
              <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
                {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} on this trade&apos;s trucks
              </p>
            </div>
            <div className="min-w-[240px] flex-1 sm:max-w-xs">
              <div className="mb-1 flex justify-between text-[10px]" style={{ color: "#71717a" }}>
                <span>Payments approved</span>
                <span>
                  {formatCurrency(approvedPkr, "PKR")} of {formatCurrency(totalTradeValuePkr, "PKR")} (
                  {(approvedPct * 100).toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${approvedPct * 100}%`, background: "linear-gradient(90deg,#34d399,#10b981)" }}
                />
              </div>
            </div>
          </div>
        </div>
        {invoices.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-subtle">
            No gate invoices yet. Enter them from the truck workflow on Truck Movements after
            assigning trucks to this trade.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            {invoices.map((inv) => (
              <GateInvoiceRow key={inv.truckId} inv={inv} tradeRef={tradeRef} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type GateInvoiceRowData = {
  truckId: string;
  gatepassNo: string;
  invoiceNo: string;
  amount: number;
  expectedPkr: number | null;
  currency: string;
  stage: GateInvoiceStage;
  truckNo: string;
};

function GateInvoiceRow({ inv, tradeRef }: { inv: GateInvoiceRowData; tradeRef: string }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState(inv.invoiceNo);
  const [amount, setAmount] = useState(String(inv.amount));

  const invalidate = () => {
    void utils.execution.gateInvoiceSummary.invalidate({ tradeRef });
    void utils.execution.pendingTrucks.invalidate();
  };
  const setStage = trpc.execution.setGateInvoiceStage.useMutation({ onSuccess: invalidate });
  const update = trpc.execution.setManualGateInvoice.useMutation({
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
  });

  const mismatch = inv.stage === "WRONG_INVOICING";

  return (
    <div
      className="px-5 py-3"
      style={mismatch ? { background: "rgba(248,113,113,0.06)" } : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="font-mono font-semibold text-emerald-400">{inv.invoiceNo}</span>
          <span className="font-mono text-muted-foreground">{inv.gatepassNo}</span>
          <span className="text-muted-foreground">🚛 {inv.truckNo}</span>
          <span>
            <span className="text-subtle">Entered </span>
            <span style={{ color: mismatch ? "#f87171" : "#f59e0b" }}>
              {formatCurrency(inv.amount, inv.currency)}
            </span>
          </span>
          <span>
            <span className="text-subtle">Expected </span>
            <span className="text-muted-foreground">
              {inv.expectedPkr != null ? formatCurrency(inv.expectedPkr, "PKR") : "—"}
            </span>
          </span>
          <StageBadge stage={inv.stage} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setInvoiceNo(inv.invoiceNo);
              setAmount(String(inv.amount));
              update.reset();
              setEditing((v) => !v);
            }}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            style={{ borderColor: "rgba(255,255,255,0.1)" }}
          >
            <Pencil className="h-3 w-3" />
            {editing ? "Close" : "Edit invoice"}
          </button>
          <select
            value={inv.stage}
            disabled={setStage.isPending || mismatch}
            title={
              mismatch
                ? "Wrong invoicing is locked — edit the invoice so the amount matches the expected value first"
                : undefined
            }
            onChange={(e) =>
              setStage.mutate({ truckId: inv.truckId, stage: e.target.value as GateInvoiceStage })
            }
            className="kastros-input kastros-input-sm text-xs disabled:opacity-50"
          >
            {GATE_INVOICE_STAGES.map((s) => (
              <option key={s} value={s}>
                {GATE_INVOICE_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder="Invoice no."
            className="kastros-input kastros-input-sm w-40 text-xs"
            aria-label="Invoice number"
          />
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount PKR"
            className="kastros-input kastros-input-sm w-36 text-xs"
            aria-label="Invoice amount (PKR)"
          />
          <button
            type="button"
            disabled={update.isPending || invoiceNo.trim() === "" || !(Number(amount) > 0)}
            onClick={() =>
              update.mutate({
                truckId: inv.truckId,
                invoiceNo: invoiceNo.trim(),
                amountPkr: Number(amount),
                tradeRef,
              })
            }
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-black disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#34d399,#10b981)" }}
          >
            {update.isPending ? "Saving…" : "Save & re-validate"}
          </button>
          <span className="text-[10px] text-subtle">
            Amount is matched against the expected value (±1 PKR) — a mismatch marks the invoice
            as wrong invoicing.
          </span>
        </div>
      )}
      {(update.error || setStage.error) && (
        <div className="mt-2 text-xs text-red-400">
          {update.error?.message ?? setStage.error?.message}
        </div>
      )}
    </div>
  );
}

function StageBadge({ stage }: { stage: GateInvoiceStage }) {
  const map: Record<GateInvoiceStage, [string, string]> = {
    PENDING_TRADE_APPROVAL: ["rgba(96,165,250,0.1)", "#60a5fa"],
    HOLD_OLD_DUES: ["rgba(245,158,11,0.1)", "#f59e0b"],
    WRONG_INVOICING: ["rgba(248,113,113,0.1)", "#f87171"],
    PAYMENT_APPROVED: ["rgba(52,211,153,0.1)", "#34d399"],
  };
  const [bg, color] = map[stage];
  return (
    <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={{ background: bg, color }}>
      {GATE_INVOICE_STAGE_LABELS[stage]}
    </span>
  );
}

function StatBadge({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2 text-center"
      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "#52525b" }}>{label}</div>
      <div className="mt-0.5 text-sm font-bold" style={{ color: color ?? "#e5e7eb" }}>{value}</div>
    </div>
  );
}

function QualBadge({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[10px] font-medium"
      style={{ background: "rgba(255,255,255,0.04)", color: "#71717a" }}
    >
      {label}: {value}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ALLOCATED: ["rgba(245,158,11,0.1)", "#f59e0b"],
    FINANCE_PENDING: ["rgba(96,165,250,0.1)", "#60a5fa"],
    PAID: ["rgba(52,211,153,0.1)", "#34d399"],
  };
  const [bg, color] = map[status] ?? ["rgba(255,255,255,0.05)", "#6b7280"];
  return (
    <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={{ background: bg, color }}>
      {status}
    </span>
  );
}

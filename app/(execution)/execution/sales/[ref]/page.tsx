"use client";

import { ContractPreviewLink } from "@/components/execution/contract-preview-link";
import { trpc } from "@/lib/trpc/client";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardList } from "lucide-react";

const fmtPKR = (n: number) =>
  "₨ " + new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n);

export default function SaleContractDetailPage() {
  const params = useParams();
  const tradeRef = decodeURIComponent(params.ref as string);
  const { data, isLoading } = trpc.execution.contractByRef.useQuery({ tradeRef });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-subtle">Loading…</div>;
  }

  if (!data?.contract) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <p className="text-sm text-muted-foreground">Contract not found or trade is not locked yet.</p>
        <Link href="/execution/sales" className="mt-2 text-xs text-warning hover:underline">
          ← Sales queue
        </Link>
      </div>
    );
  }

  const c = data.contract;
  const unit = c.quantityUnit;
  const pct = c.contractualQtyMt > 0 ? Math.min(c.receivedQtyMt / c.contractualQtyMt, 1) : 0;

  const statuses = data.outbound.reduce(
    (acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="kastros-desk-page">
      <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
        <Link href="/execution" className="hover:text-foreground">Desk</Link>
        <span>/</span>
        <Link href="/execution/sales" className="hover:text-foreground">Sales</Link>
        <span>/</span>
        <span style={{ color: "#a1a1aa" }}>{tradeRef}</span>
      </div>

      <div className="rounded-2xl p-5" style={{ background: "rgba(167,139,250,0.05)", border: "1px solid rgba(167,139,250,0.12)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-xl font-bold" style={{ color: "#a78bfa" }}>{c.tradeRef}</h1>
            <p className="mt-0.5 text-sm font-medium text-foreground">{c.counterpartyName}</p>
            <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
              {c.warehouseDefault ?? "—"} · PKR {c.ratePerMaund?.toFixed(0) ?? "—"}/Maund
              {c.deliveryEnd && (
                <span className="ml-2">· Due {new Date(c.deliveryEnd).toLocaleDateString("en-PK")}</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex gap-3">
            <SBadge label="Contract Qty" value={formatQtyWithUnit(c.contractualQtyMt, unit, 2)} />
            <SBadge label="Released" value={formatQtyWithUnit(c.receivedQtyMt, unit, 2)} color="#a78bfa" />
            <SBadge
              label="Remaining"
              value={formatQtyWithUnit(c.openQtyMt, unit, 2)}
              color={c.openQtyMt > 0 ? "#f59e0b" : "#6b7280"}
            />
            </div>
            <ContractPreviewLink tradeRef={tradeRef} />
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-[10px]" style={{ color: "#71717a" }}>
            <span>Release progress</span>
            <span>{(pct * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${pct * 100}%`, background: "linear-gradient(90deg,#a78bfa,#7c3aed)" }}
            />
          </div>
        </div>
        {Object.keys(statuses).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(statuses).map(([s, count]) => (
              <span
                key={s}
                className="rounded-full px-2.5 py-1 text-[10px] font-medium"
                style={{ background: "rgba(255,255,255,0.04)", color: "#a1a1aa" }}
              >
                {count}× {s.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
        style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)" }}
      >
        <div>
          <p className="text-sm font-semibold text-purple-300">Outbound trucks release via Truck Movements</p>
          <p className="mt-0.5 text-xs text-subtle">
            Releases go through the payment workflow on the Truck Movements page — assign the
            gatepass truck to this sale there, confirm the buyer&rsquo;s payment (or CEO clearance),
            then print the Gate Out Slip and Delivery Order.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/execution/movements"
            className="rounded-xl px-4 py-2 text-xs font-bold text-foreground"
            style={{ background: "linear-gradient(135deg,#a78bfa,#7c3aed)" }}
          >
            Truck Movements →
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
          <h2 className="text-sm font-semibold text-foreground">Dispatch history</h2>
          <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
            {data.outbound.length} truck{data.outbound.length !== 1 ? "s" : ""} from gatepass assignment
          </p>
        </div>
        {data.outbound.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-subtle">
            No outbound trucks linked yet. Assign from the sales queue after gatepass entry.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            {data.outbound.map((d) => (
              <div key={d.id} className="space-y-2 px-5 py-3">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-mono font-semibold text-purple-300">🚛 {d.truckNo}</span>
                  <span className="font-mono text-subtle">{d.gatepassNo ?? d.id}</span>
                  <span className="text-muted-foreground">{formatQtyWithUnit(d.allocatedQtyMt, unit, 3)}</span>
                  <span style={{ color: "#f59e0b" }}>{fmtPKR(d.amountDue)}</span>
                  {d.doRef && (
                    <span className="font-mono text-[10px]" style={{ color: "#34d399" }}>
                      DO: {d.doRef}
                    </span>
                  )}
                  <DispatchBadge status={d.status} />
                </div>
                {d.status === "RELEASED" && (
                  <span className="text-[11px]" style={{ color: "#34d399" }}>
                    ✓ Released
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SBadge({ label, value, color }: { label: string; value: string; color?: string }) {
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

function DispatchBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    WEIGHED: ["rgba(96,165,250,0.12)", "#60a5fa"],
    FINANCE_PENDING: ["rgba(251,146,60,0.12)", "#fb923c"],
    RELEASED: ["rgba(52,211,153,0.12)", "#34d399"],
  };
  const [bg, color] = map[status] ?? ["rgba(255,255,255,0.05)", "#6b7280"];
  return (
    <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={{ background: bg, color }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

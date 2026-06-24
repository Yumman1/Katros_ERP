"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { summarizeQtyByUnit } from "@/lib/formatters/execution-units";
import Link from "next/link";

const EXEC_REFETCH_MS = 8000;

const STATE_LABELS: Record<string, string> = {
  CONTRACT: "Contract Received", SELECTED: "Selector at Mandi", LOADED: "Vehicle Loaded",
  DC_ISSUED: "DC Issued", INVOICED: "Invoiced", FINANCE_PENDING: "Finance Pending",
  PAID: "Paid", ON_THE_WAY: "On the Way", RECEIVED: "Received at WH",
};
const STATE_COLOR: Record<string, string> = {
  CONTRACT: "#71717a", SELECTED: "#60a5fa", LOADED: "#f59e0b", DC_ISSUED: "#f59e0b",
  INVOICED: "#a78bfa", FINANCE_PENDING: "#fb923c", PAID: "#34d399",
  ON_THE_WAY: "#60a5fa", RECEIVED: "#34d399",
};

export default function PurchaseSpotPage() {
  const { data: contracts, isLoading } = trpc.execution.lockedContracts.useQuery(
    { profile: "PURCHASE_SPOT" },
    { refetchInterval: EXEC_REFETCH_MS },
  );
  const { data: pending } = trpc.execution.pendingForLock.useQuery(undefined, {
    refetchInterval: EXEC_REFETCH_MS,
  });
  const spotPending =
    pending?.filter((t) => t.direction === "BUY" && t.expectedProfile === "PURCHASE_SPOT") ?? [];

  const open = contracts?.filter((c) => c.contractStatus === "Open") ?? [];
  const closed = contracts?.filter((c) => c.contractStatus !== "Open") ?? [];
  const hasAny = (contracts?.length ?? 0) > 0 || spotPending.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
          <Link href="/execution" className="hover:text-white">Desk</Link>
          <span>/</span>
          <span style={{ color: "#a1a1aa" }}>Purchase — Spot</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-white">Purchase — Spot</h1>
        <p className="mt-1 text-sm" style={{ color: "#71717a" }}>
          Selector → Mandi → Broker → Vehicle Loaded → DC → Invoice → Finance → Received
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Chip label="Awaiting lock" value={spotPending.length} color="#f87171" />
        <Chip label="Open" value={open.length} color="#60a5fa" />
        <Chip label="Closed" value={closed.length} color="#6b7280" />
        <Chip
          label="Total open qty"
          value={summarizeQtyByUnit(open.map((c) => ({ qty: c.openQtyMt, unit: c.quantityUnit })))}
          color="#f59e0b"
        />
      </div>

      {spotPending.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#f87171" }}>
            Awaiting lock from trader
          </h2>
          <p className="mb-3 text-xs" style={{ color: "#71717a" }}>
            Booked as Spot but not locked yet — the trader must open the trade and click &quot;Lock for execution&quot;
            with buying category <strong className="text-zinc-400">Spot</strong>.
          </p>
          <div className="space-y-2">
            {spotPending.map((t) => (
              <div
                key={t.tradeRef}
                className="rounded-2xl p-4"
                style={{ background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.2)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="font-mono text-sm font-bold" style={{ color: "#f87171" }}>{t.tradeRef}</span>
                    <p className="mt-0.5 text-sm font-medium text-white">{t.counterpartyName}</p>
                    <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
                      {formatQtyWithUnit(t.quantity, t.quantityUnit, 2)} · {t.commodityName} · Trader: {t.traderName}
                    </p>
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}>
                    Pending lock
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {open.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#71717a" }}>Active Pipeline</h2>
          <div className="space-y-2">
            {open.map((c) => <SpotCard key={c.tradeRef} contract={c} />)}
          </div>
        </section>
      )}
      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#52525b" }}>Completed</h2>
          <div className="space-y-2">
            {closed.map((c) => <SpotCard key={c.tradeRef} contract={c} dim />)}
          </div>
        </section>
      )}
      {isLoading && <div className="py-12 text-center text-sm text-zinc-500">Loading…</div>}
      {!isLoading && !hasAny && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
            <svg className="h-8 w-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" /></svg>
          </div>
          <p className="text-sm text-zinc-400">No spot purchase contracts yet</p>
          <p className="mt-2 max-w-md text-xs text-zinc-600">
            Trader books a BUY with buying category <strong className="text-zinc-500">Spot</strong>, then locks the trade.
            Locked spot contracts appear here automatically (refreshes every few seconds).
          </p>
        </div>
      )}
    </div>
  );
}

function SpotCard({ contract: c, dim }: { contract: { tradeRef: string; counterpartyName: string; contractualQtyMt: number; quantityUnit: string; contractStatus: string; warehouseDefault?: string | null }, dim?: boolean }) {
  const { data: spot } = trpc.execution.spotEvent.useQuery({ tradeRef: c.tradeRef });
  const state = spot?.state ?? "CONTRACT";
  const color = STATE_COLOR[state] ?? "#71717a";
  const PIPELINE = ["CONTRACT", "SELECTED", "LOADED", "DC_ISSUED", "INVOICED", "ON_THE_WAY", "RECEIVED"];
  const stageIdx = PIPELINE.indexOf(state);

  return (
    <Link href={`/execution/purchase-spot/${encodeURIComponent(c.tradeRef)}`}
      className="group block rounded-2xl p-4 transition-all hover:border-blue-500/30"
      style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${dim ? "rgba(255,255,255,0.04)" : "rgba(96,165,250,0.12)"}`, opacity: dim ? 0.6 : 1 }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold" style={{ color: dim ? "#52525b" : "#60a5fa" }}>{c.tradeRef}</span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${color}18`, color }}>{STATE_LABELS[state] ?? state}</span>
          </div>
          <p className="mt-0.5 text-sm font-medium text-white">{c.counterpartyName}</p>
          <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>{formatQtyWithUnit(c.contractualQtyMt, c.quantityUnit, 2)} · {c.warehouseDefault ?? "—"}</p>
        </div>
        <svg className="h-4 w-4 flex-shrink-0 text-zinc-600 group-hover:text-zinc-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M9 5l7 7-7 7" /></svg>
      </div>
      {/* Mini pipeline */}
      <div className="mt-3 flex items-center gap-1">
        {PIPELINE.map((s, i) => (
          <div key={s} className="flex-1 h-1.5 rounded-full" style={{ background: i <= stageIdx ? color : "rgba(255,255,255,0.06)" }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px]" style={{ color: "#52525b" }}>
        <span>Contract</span><span>Received</span>
      </div>
    </Link>
  );
}

function Chip({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: "#71717a" }}>{label}</div>
    </div>
  );
}

"use client";

import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import Link from "next/link";

const STATE_LABELS: Record<string, string> = {
  CONTRACT: "Contract",
  SELECTED: "Selected",
  LOADED: "Loaded",
  DC_ISSUED: "DC Issued",
  INVOICED: "Invoiced",
  FINANCE_PENDING: "Finance pending",
  PAID: "Paid",
  ON_THE_WAY: "On the way",
  RECEIVED: "Received",
};

const STATE_COLOR: Record<string, string> = {
  CONTRACT: "#71717a",
  SELECTED: "#60a5fa",
  LOADED: "#f59e0b",
  DC_ISSUED: "#f59e0b",
  INVOICED: "#a78bfa",
  FINANCE_PENDING: "#fb923c",
  PAID: "#34d399",
  ON_THE_WAY: "#60a5fa",
  RECEIVED: "#34d399",
};

const PIPELINE = ["CONTRACT", "SELECTED", "LOADED", "DC_ISSUED", "INVOICED", "ON_THE_WAY", "RECEIVED"] as const;

type ContractRow = {
  tradeRef: string;
  counterpartyName: string;
  commodityCode: string;
  commodityName: string;
  quantityUnit: string;
  openQtyMt: number;
};

type SpotRow = {
  tradeRef: string;
  state: string;
};

type Props = {
  contracts: ContractRow[];
  spotEvents: SpotRow[];
  detailBasePath: string;
};

export function SpotPipelinePanel({ contracts, spotEvents, detailBasePath }: Props) {
  const spotByRef = new Map(spotEvents.map((s) => [s.tradeRef, s.state]));

  if (contracts.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Spot workflow — mandi to warehouse
      </h3>
      <p className="mb-3 text-xs text-zinc-600">
        Gate allocation records warehouse receipt. Use the trade detail page to advance selector, DC, invoice, and
        on-the-way steps.
      </p>
      <div
        className="overflow-x-auto rounded-2xl"
        style={{ border: "1px solid rgba(96,165,250,0.15)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Counterparty</th>
              <th className="px-4 py-3">Open</th>
              <th className="px-4 py-3">Spot stage</th>
              <th className="px-4 py-3">Pipeline</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => {
              const state = spotByRef.get(c.tradeRef) ?? "CONTRACT";
              const color = STATE_COLOR[state] ?? "#71717a";
              const stageIdx = PIPELINE.indexOf(state as (typeof PIPELINE)[number]);
              return (
                <tr key={c.tradeRef} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <Link
                      href={`${detailBasePath}/${encodeURIComponent(c.tradeRef)}`}
                      className="font-mono font-semibold text-sky-400 hover:underline"
                    >
                      {c.tradeRef}
                    </Link>
                    <div className="text-xs text-zinc-500">
                      {c.commodityName} ({c.commodityCode})
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{c.counterpartyName}</td>
                  <td className="px-4 py-3 font-semibold text-white">
                    {formatQtyWithUnit(c.openQtyMt, c.quantityUnit, 2)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: `${color}18`, color }}
                    >
                      {STATE_LABELS[state] ?? state}
                    </span>
                  </td>
                  <td className="px-4 py-3 min-w-[140px]">
                    <div className="flex items-center gap-0.5">
                      {PIPELINE.map((s, i) => (
                        <div
                          key={s}
                          className="h-1.5 flex-1 rounded-full"
                          style={{ background: i <= stageIdx ? color : "rgba(255,255,255,0.06)" }}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`${detailBasePath}/${encodeURIComponent(c.tradeRef)}`}
                      className="text-xs text-sky-400 hover:underline"
                    >
                      Workflow →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQty } from "@/lib/formatters/numbers";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as XLSX from "xlsx";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export default function PositionsPage() {
  const [asOf, setAsOf] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const date = useMemo(() => new Date(asOf), [asOf]);

  const summary = trpc.positions.getExposureSummary.useQuery({ date });
  const cards = trpc.positions.getSummaryCards.useQuery({ date });
  const book = trpc.positions.getBook.useQuery({ date, limit: 200 });

  const chartData =
    cards.data?.map((c) => ({
      code: c.code,
      long: c.longQty,
      short: -c.shortQty,
    })) ?? [];

  const exportXlsx = () => {
    if (!book.data?.length) return;
    const ws = XLSX.utils.json_to_sheet(book.data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PositionBook");
    XLSX.writeFile(wb, `kastros-positions-${asOf}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Position dashboard</h1>
          <p className="text-sm text-zinc-500">Live risk by commodity and trade leg.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-zinc-400">
            As of
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="ml-2 rounded border border-kastros-border bg-kastros-bg px-2 py-1 text-sm text-white"
            />
          </label>
          <button
            type="button"
            onClick={exportXlsx}
            className="rounded-md bg-kastros-green px-3 py-1.5 text-sm font-medium text-kastros-bg"
          >
            Export Excel
          </button>
        </div>
      </div>

      {summary.data && (
        <div className="sticky top-0 z-20 flex flex-wrap gap-3 border-b border-kastros-border bg-kastros-bg/95 py-3 backdrop-blur">
          <Stat
            label="Net exposure (MT)"
            value={formatQty(summary.data.netExposure)}
            tone="neutral"
          />
          <Stat
            label="Net MTM"
            value={formatCurrency(summary.data.netMTM)}
            tone={summary.data.netMTM >= 0 ? "up" : "down"}
          />
          <Stat label="Total long" value={formatQty(summary.data.totalLong)} tone="up" />
          <Stat label="Total short" value={formatQty(summary.data.totalShort)} tone="down" />
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-4">
        {cards.isLoading &&
          [...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-kastros-border bg-kastros-card"
            />
          ))}
        {cards.data?.map((c) => (
          <div
            key={c.commodityId}
            className="rounded-lg border border-kastros-border bg-kastros-card p-3 text-sm"
          >
            <div className="font-medium text-white">
              {c.code}{" "}
              <span className="text-xs font-normal text-zinc-500">{c.name}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-zinc-400">
              <span>Net {formatQty(c.netQty)}</span>
              <span>L {formatQty(c.longQty)} / S {formatQty(c.shortQty)}</span>
              <span>Mkt {formatCurrency(c.marketPrice)}</span>
              <span className={c.dayChangePct >= 0 ? "text-kastros-green" : "text-kastros-red"}>
                Δ {((c.dayChangePct ?? 0) * 100).toFixed(2)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <div className="overflow-hidden rounded-lg border border-kastros-border bg-kastros-card">
          <div className="border-b border-kastros-border px-3 py-2 text-sm font-medium text-zinc-300">
            Position book
          </div>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-kastros-card text-left text-xs uppercase text-zinc-500">
                <tr>
                  {[
                    "Commodity",
                    "Dir",
                    "Qty",
                    "Book",
                    "Mkt",
                    "MTM",
                    "%Δ",
                    "Trade",
                    "CP",
                  ].map((h) => (
                    <th key={h} className="border-b border-kastros-border px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="data-grid">
                {book.data?.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "h-9 border-b border-kastros-border/80",
                      r.mtmPnl >= 0 ? "bg-kastros-green/5" : "bg-kastros-red/5",
                    )}
                  >
                    <td className="px-2 py-1 text-zinc-200">{r.commodity}</td>
                    <td className="px-2 py-1">{r.direction}</td>
                    <td className="px-2 py-1">{formatQty(r.quantity)}</td>
                    <td className="px-2 py-1">{formatCurrency(r.bookPrice, r.currency)}</td>
                    <td className="px-2 py-1">{formatCurrency(r.marketPrice, r.currency)}</td>
                    <td
                      className={cn(
                        "px-2 py-1",
                        r.mtmPnl >= 0 ? "text-kastros-green" : "text-kastros-red",
                      )}
                    >
                      {formatCurrency(r.mtmPnl, r.currency)}
                    </td>
                    <td className="px-2 py-1">{(r.pctChange * 100).toFixed(2)}%</td>
                    <td className="px-2 py-1 text-zinc-400">{r.tradeRef}</td>
                    <td className="max-w-[140px] truncate px-2 py-1 text-zinc-500">{r.counterparty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="space-y-3">
          <div className="rounded-lg border border-kastros-border bg-kastros-card p-3">
            <div className="text-sm font-medium text-zinc-300">Top exposure (abs MTM)</div>
            <ol className="mt-2 space-y-1 text-xs text-zinc-400">
              {book.data
                ?.slice()
                .sort((a, b) => Math.abs(b.mtmPnl) - Math.abs(a.mtmPnl))
                .slice(0, 5)
                .map((r, i) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span>
                      {i + 1}. {r.commodity} {r.tradeRef}
                    </span>
                    <span
                      className={r.mtmPnl >= 0 ? "text-kastros-green" : "text-kastros-red"}
                    >
                      {formatCurrency(r.mtmPnl, r.currency)}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
          <div className="rounded-lg border border-kastros-border bg-kastros-card p-3 text-xs text-zinc-500">
            Price alerts panel — wire threshold rules in Phase 1.5.
          </div>
        </aside>
      </div>

      <div className="h-64 rounded-lg border border-kastros-border bg-kastros-card p-3">
        <div className="mb-2 text-sm font-medium text-zinc-300">Long vs short by commodity</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={chartData} stackOffset="sign">
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
            <XAxis dataKey="code" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip
              contentStyle={{ background: "#1a1f2e", border: "1px solid #2a3142" }}
              labelStyle={{ color: "#fff" }}
            />
            <Legend />
            <Bar dataKey="long" stackId="a" fill="#00C896" name="Long" />
            <Bar dataKey="short" stackId="a" fill="#FF4D4F" name="Short (neg)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "neutral";
}) {
  return (
    <div className="rounded-md border border-kastros-border bg-kastros-card px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={cn(
          "data-grid text-lg font-semibold",
          tone === "up" && "text-kastros-green",
          tone === "down" && "text-kastros-red",
          tone === "neutral" && "text-white",
        )}
      >
        {value}
      </div>
    </div>
  );
}

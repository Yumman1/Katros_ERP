"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const fmtQty = (n: number) =>
  n.toLocaleString("en-PK", { maximumFractionDigits: 2 });
const fmtMoney = (n: number) =>
  n.toLocaleString("en-PK", { maximumFractionDigits: 0 });

function money(v: number | null, parens = true): string {
  if (v == null) return "—";
  if (v < 0 && parens) return `(${fmtMoney(Math.abs(v))})`;
  return fmtMoney(v);
}

/**
 * The desk's daily "Net Position" mail, live: one column per commodity +
 * season. Quantities and the entry rate are computed from the book; the
 * market rate and FX are desk-entered per column.
 */
export function NetPositionPanel({
  canEdit,
  /** "ALL" shows every commodity's columns; a code narrows to that commodity. */
  commodityFilter = "ALL",
}: {
  canEdit: boolean;
  commodityFilter?: string;
}) {
  const utils = trpc.useUtils();
  const { data: all, isLoading } = trpc.trader.seasonNetPositions.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const cols =
    commodityFilter === "ALL"
      ? all
      : all?.filter((c) => c.commodityCode === commodityFilter);
  const save = trpc.trader.setPositionMarketInput.useMutation({
    onSuccess: () => {
      setEditing(null);
      void utils.trader.seasonNetPositions.invalidate();
    },
  });

  /** Which column's market/FX inputs are open, keyed commodity::season. */
  const [editing, setEditing] = useState<string | null>(null);
  const [marketDraft, setMarketDraft] = useState("");
  const [fxDraft, setFxDraft] = useState("");

  if (isLoading) {
    return <div className="animate-pulse text-sm text-subtle">Loading net position…</div>;
  }
  if (!cols?.length) {
    return (
      <section className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-subtle">
        No position in {commodityFilter === "ALL" ? "any commodity" : commodityFilter} yet — book a
        trade or take stock in and the net position builds itself.
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-foreground">Net Position</h2>
        <span className="text-[11px] text-subtle">
          Net = open purchases + inventory − open sales · valued at market − entry over the net
          position
        </span>
      </div>

      <div className="overflow-x-auto px-5 py-4">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left">
              <th className="pb-2 pr-4 text-xs font-medium text-subtle">Description</th>
              {cols.map((c) => (
                <th
                  key={`${c.commodityCode}-${c.season}`}
                  className="pb-2 pr-4 text-right text-xs font-semibold text-foreground"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <Row label="Net Position (MT)" bold values={cols.map((c) => fmtQty(c.netPositionMt))} />
            <Row label="Open Purchases" values={cols.map((c) => (c.openPurchasesMt ? fmtQty(c.openPurchasesMt) : "-"))} />
            <Row label="Inventory (At Warehouse)" values={cols.map((c) => (c.inventoryMt ? fmtQty(c.inventoryMt) : "-"))} />
            <Row label="Open Sales" values={cols.map((c) => (c.openSalesMt ? fmtQty(c.openSalesMt) : "-"))} />

            <tr>
              <td colSpan={cols.length + 1} className="border-b border-border pt-2" />
            </tr>

            <Row
              label="Market Rate (₨/maund)"
              values={cols.map((c) =>
                c.marketRatePkrPerMaund != null ? fmtMoney(c.marketRatePkrPerMaund) : "—",
              )}
            />
            <Row
              label="Trade Entry Rate (₨/maund)"
              values={cols.map((c) =>
                c.tradeEntryRatePkrPerMaund != null ? fmtMoney(c.tradeEntryRatePkrPerMaund) : "—",
              )}
            />
            <Row
              label="In/(Out) of the money — per maund"
              bold
              tone={(i) => toneOf(cols[i]?.inOutPerMaund)}
              values={cols.map((c) => money(c.inOutPerMaund))}
            />
            <Row
              label="In/(Out) of the money — value (PKR)"
              tone={(i) => toneOf(cols[i]?.inOutValuePkr)}
              values={cols.map((c) => money(c.inOutValuePkr))}
            />
            <Row
              label="In/(Out) of the money — value (USD)"
              tone={(i) => toneOf(cols[i]?.inOutValueUsd)}
              values={cols.map((c) => money(c.inOutValueUsd))}
            />
            <Row
              label="FX"
              values={cols.map((c) =>
                c.fxRate != null ? c.fxRate.toLocaleString("en-PK", { maximumFractionDigits: 4 }) : "—",
              )}
            />
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
          {cols.map((c) => {
            const key = `${c.commodityCode}::${c.season}`;
            const open = editing === key;
            return (
              <div key={key} className="flex flex-wrap items-center gap-2">
                {open ? (
                  <>
                    <span className="text-xs font-medium text-foreground">{c.label}:</span>
                    <input
                      type="number"
                      value={marketDraft}
                      onChange={(e) => setMarketDraft(e.target.value)}
                      placeholder="Market ₨/maund"
                      className="kastros-input kastros-input-sm w-32"
                    />
                    <input
                      type="number"
                      value={fxDraft}
                      onChange={(e) => setFxDraft(e.target.value)}
                      placeholder="FX (USD)"
                      className="kastros-input kastros-input-sm w-28"
                    />
                    <button
                      type="button"
                      disabled={save.isPending}
                      onClick={() =>
                        save.mutate({
                          commodityCode: c.commodityCode,
                          season: c.season,
                          marketRatePkrPerMaund: Number(marketDraft) > 0 ? Number(marketDraft) : null,
                          fxRate: Number(fxDraft) > 0 ? Number(fxDraft) : null,
                        })
                      }
                      className="kastros-btn-primary !px-3 !py-1 text-xs disabled:opacity-50"
                    >
                      {save.isPending ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="text-xs text-subtle hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(key);
                      setMarketDraft(
                        c.marketRatePkrPerMaund != null ? String(c.marketRatePkrPerMaund) : "",
                      );
                      setFxDraft(c.fxRate != null ? String(c.fxRate) : "");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5"
                  >
                    <Pencil className="h-3 w-3" />
                    {c.label} market / FX
                  </button>
                )}
              </div>
            );
          })}
          {save.error && <span className="text-xs text-destructive">{save.error.message}</span>}
        </div>
      )}
    </section>
  );
}

function toneOf(v: number | null | undefined): string {
  if (v == null) return "";
  return v < 0 ? "text-destructive" : "text-success";
}

function Row({
  label,
  values,
  bold,
  tone,
}: {
  label: string;
  values: string[];
  bold?: boolean;
  tone?: (colIndex: number) => string;
}) {
  return (
    <tr>
      <td className={cn("py-1 pr-4 text-xs", bold ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className={cn(
            "py-1 pr-4 text-right",
            bold ? "font-semibold text-foreground" : "text-muted-foreground",
            tone?.(i),
          )}
        >
          {v}
        </td>
      ))}
    </tr>
  );
}

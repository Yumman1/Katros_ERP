"use client";

import { formatQty } from "@/lib/formatters/numbers";
import { cn } from "@/lib/utils";

export type PositionLedgerRow = {
  commodityCode: string;
  commodityName: string;
  unit: string;
  paperLong: number;
  paperShort: number;
  paperNet: number;
  physicalInbound: number;
  physicalOutbound: number;
  physicalNet: number;
  variance: number;
  manualAdjustment: number;
  adjustedPhysical: number;
  netPosition: number;
  openBuyTrades: number;
  openSellTrades: number;
};

type Props = {
  rows: PositionLedgerRow[];
  commodityFilter?: string;
  editable?: boolean;
  onSaveAdjustment?: (commodityCode: string, deltaMt: number) => void;
  savingCode?: string | null;
};

export function PositionLedgerTable({
  rows,
  commodityFilter = "ALL",
  editable = false,
  onSaveAdjustment,
  savingCode,
}: Props) {
  const filtered =
    commodityFilter === "ALL" ? rows : rows.filter((r) => r.commodityCode === commodityFilter);

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No position data for this filter yet. Lock trades and record warehouse movements to build the ledger.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2.5">Commodity</th>
            <th className="px-3 py-2.5 text-right">Paper long</th>
            <th className="px-3 py-2.5 text-right">Paper short</th>
            <th className="px-3 py-2.5 text-right">Paper net</th>
            <th className="px-3 py-2.5 text-right">Physical in</th>
            <th className="px-3 py-2.5 text-right">Physical out</th>
            <th className="px-3 py-2.5 text-right">Physical net</th>
            {editable && <th className="px-3 py-2.5 text-right">Manual adj.</th>}
            <th className="px-3 py-2.5 text-right">Variance</th>
            <th className="px-3 py-2.5 text-right">Net position</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <PositionRow
              key={r.commodityCode}
              row={r}
              editable={editable}
              saving={savingCode === r.commodityCode}
              onSaveAdjustment={onSaveAdjustment}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionRow({
  row,
  editable,
  saving,
  onSaveAdjustment,
}: {
  row: PositionLedgerRow;
  editable: boolean;
  saving: boolean;
  onSaveAdjustment?: (code: string, delta: number) => void;
}) {
  const varianceBreak = Math.abs(row.variance) > 0.5;

  return (
    <tr className="border-b border-border/70 hover:bg-foreground/[0.02]">
      <td className="px-3 py-2.5">
        <div className="font-medium text-foreground">{row.commodityCode}</div>
        <div className="text-xs text-muted-foreground">{row.commodityName}</div>
      </td>
      <td className="data-grid px-3 py-2.5 text-right text-success">{formatQty(row.paperLong)}</td>
      <td className="data-grid px-3 py-2.5 text-right text-destructive">{formatQty(row.paperShort)}</td>
      <td className="data-grid px-3 py-2.5 text-right font-medium text-foreground">{formatQty(row.paperNet)}</td>
      <td className="data-grid px-3 py-2.5 text-right text-muted-foreground">{formatQty(row.physicalInbound)}</td>
      <td className="data-grid px-3 py-2.5 text-right text-muted-foreground">{formatQty(row.physicalOutbound)}</td>
      <td className="data-grid px-3 py-2.5 text-right font-medium text-foreground">{formatQty(row.physicalNet)}</td>
      {editable && (
        <td className="px-3 py-2.5 text-right">
          <ManualAdjInput
            code={row.commodityCode}
            value={row.manualAdjustment}
            saving={saving}
            onSave={onSaveAdjustment}
          />
        </td>
      )}
      <td
        className={cn(
          "data-grid px-3 py-2.5 text-right font-medium",
          varianceBreak ? "text-warning" : "text-muted-foreground",
        )}
      >
        {formatQty(row.variance)}
      </td>
      <td
        className={cn(
          "data-grid px-3 py-2.5 text-right font-semibold",
          row.netPosition > 0 ? "text-success" : row.netPosition < 0 ? "text-destructive" : "text-foreground",
        )}
      >
        {formatQty(row.netPosition)}
      </td>
    </tr>
  );
}

function ManualAdjInput({
  code,
  value,
  saving,
  onSave,
}: {
  code: string;
  value: number;
  saving: boolean;
  onSave?: (code: string, delta: number) => void;
}) {
  return (
    <input
      type="number"
      step="0.001"
      defaultValue={value === 0 ? "" : value}
      key={`${code}-${value}`}
      disabled={saving}
      placeholder="0"
      className="kastros-input data-grid w-24 px-2 py-1 text-right text-xs"
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const next = raw === "" ? 0 : Number(raw);
        if (!Number.isFinite(next)) return;
        if (Math.abs(next - value) < 0.0001) return;
        onSave?.(code, next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function PositionLegend() {
  return (
    <div className="rounded-xl border border-border bg-card/80 px-4 py-3 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">How position is calculated</p>
      <ul className="mt-2 list-inside list-disc space-y-1">
        <li>
          <strong className="text-foreground">Paper</strong> — open quantity on locked trades (buys add, sells subtract).
        </li>
        <li>
          <strong className="text-foreground">Physical</strong> — warehouse receipts minus outbound trucks once weighed
          at gate (not only after finance release).
        </li>
        <li>
          <strong className="text-foreground">Variance</strong> — paper net minus physical net (breaks highlight in amber).
        </li>
        <li>
          <strong className="text-foreground">Net position</strong> — paper net minus adjusted physical (after manual
          corrections on execution desk).
        </li>
      </ul>
    </div>
  );
}

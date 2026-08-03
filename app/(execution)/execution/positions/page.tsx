"use client";

import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import { PositionLegend, PositionLedgerTable } from "@/components/position/position-ledger-table";
import { collectCommodityOptions } from "@/lib/execution-commodity-filter";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

type Tab = "ledger" | "fx";

export default function ExecutionPositionsPage() {
  const [tab, setTab] = useState<Tab>("ledger");
  const [commodityFilter, setCommodityFilter] = useState("ALL");
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data: rows, isLoading } = trpc.execution.positionLedger.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const setAdj = trpc.execution.setPositionAdjustment.useMutation({
    onMutate: ({ commodityCode }) => setSavingCode(commodityCode),
    onSettled: () => {
      setSavingCode(null);
      void utils.execution.positionLedger.invalidate();
    },
  });

  const commodityOptions = useMemo(
    () =>
      collectCommodityOptions(
        (rows ?? []).map((r) => ({ commodityCode: r.commodityCode, commodityName: r.commodityName })),
      ),
    [rows],
  );

  const totals = useMemo(() => {
    const list =
      commodityFilter === "ALL" ? (rows ?? []) : (rows ?? []).filter((r) => r.commodityCode === commodityFilter);
    return list.reduce(
      (acc, r) => {
        acc.paperNet += r.paperNet;
        acc.physicalNet += r.physicalNet;
        acc.variance += r.variance;
        return acc;
      },
      { paperNet: 0, physicalNet: 0, variance: 0 },
    );
  }, [rows, commodityFilter]);

  return (
    <DeskPage>
      <DeskScroll className="space-y-5 pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Position ledger</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paper vs physical balance by commodity, plus desk FX for dollar MTM conversion.
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <TabButton active={tab === "ledger"} onClick={() => setTab("ledger")}>
            Position ledger
          </TabButton>
          <TabButton active={tab === "fx"} onClick={() => setTab("fx")}>
            USD / PKR rate
          </TabButton>
        </div>

        {tab === "ledger" ? (
          <>
            {commodityOptions.length > 0 && (
              <CommodityFilterBar
                commodities={commodityOptions}
                value={commodityFilter}
                onChange={setCommodityFilter}
              />
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Paper net (MT)" value={totals.paperNet.toFixed(2)} />
              <Stat label="Physical net (MT)" value={totals.physicalNet.toFixed(2)} />
              <Stat
                label="Variance (MT)"
                value={totals.variance.toFixed(2)}
                warn={Math.abs(totals.variance) > 0.5}
              />
            </div>

            <PositionLegend />

            {isLoading ? (
              <div className="animate-pulse text-muted-foreground">Loading position ledger…</div>
            ) : (
              <PositionLedgerTable
                rows={rows ?? []}
                commodityFilter={commodityFilter}
                editable
                savingCode={savingCode}
                onSaveAdjustment={(code, delta) => setAdj.mutate({ commodityCode: code, deltaMt: delta })}
              />
            )}

            {setAdj.error && <p className="text-sm text-destructive">{setAdj.error.message}</p>}
          </>
        ) : (
          <FxRatePanel />
        )}
      </DeskScroll>
    </DeskPage>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FxRatePanel() {
  const utils = trpc.useUtils();
  const { data: fx, isLoading } = trpc.market.fxRate.useQuery(undefined, { refetchInterval: 60_000 });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = trpc.market.setFxRate.useMutation({
    onSuccess: () => {
      setError(null);
      setDraft("");
      void utils.market.fxRate.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rate = Number(draft.trim() || (fx?.rate != null ? String(fx.rate) : ""));
    if (!Number.isFinite(rate) || rate <= 0) {
      setError("Enter a positive PKR-per-USD rate (e.g. 277.8522).");
      return;
    }
    setError(null);
    save.mutate({ rate });
  };

  return (
    <div className="max-w-lg rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold text-foreground">USD → PKR exchange rate</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Used to convert in/(out)-of-the-money PKR values to USD on position and MTM views — same as your
        Net Position sheet (PKR value ÷ this rate).
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              PKR per 1 USD
            </span>
            <input
              type="number"
              step="0.0001"
              min="0"
              placeholder={fx?.rate != null ? String(fx.rate) : "277.8522"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="kastros-input w-full data-grid"
            />
          </label>

          {fx ? (
            <p className="text-xs text-muted-foreground">
              Current: <strong className="text-foreground">{fx.rate.toLocaleString("en-PK")}</strong> PKR/USD
              {fx.updatedBy ? ` · set by ${fx.updatedBy}` : ""}
              {fx.updatedAt ? ` · ${fx.updatedAt.slice(0, 16).replace("T", " ")}` : ""}
            </p>
          ) : (
            <p className="text-xs text-amber-700">No FX rate saved yet — USD columns will stay blank until you publish one.</p>
          )}

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={save.isPending}
            className="kastros-btn-primary px-4 py-2 text-sm disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Publish FX rate"}
          </button>
        </form>
      )}

      <div className="mt-6 rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Example: PKR 50,356,250 ÷ 277.8522 ≈ USD 181,234 (Corn Summer in-the-money on your sheet).
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-warning" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

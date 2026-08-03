"use client";

import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { NetPositionPanel } from "@/components/position/net-position-panel";
import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import { collectCommodityOptions } from "@/lib/execution-commodity-filter";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

type Tab = "net" | "fx";

export default function ExecutionPositionsPage() {
  const [tab, setTab] = useState<Tab>("net");
  const [commodityFilter, setCommodityFilter] = useState("ALL");
  const { data: seasonCols } = trpc.trader.seasonNetPositions.useQuery();

  const commodityOptions = useMemo(
    () =>
      collectCommodityOptions(
        (seasonCols ?? []).map((c) => ({
          commodityCode: c.commodityCode,
          commodityName: c.commodityName,
        })),
      ),
    [seasonCols],
  );

  return (
    <DeskPage>
      <DeskScroll className="space-y-5 pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Position</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Net position by commodity and crop season, plus desk FX for dollar MTM conversion.
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <TabButton active={tab === "net"} onClick={() => setTab("net")}>
            Net position
          </TabButton>
          <TabButton active={tab === "fx"} onClick={() => setTab("fx")}>
            USD / PKR rate
          </TabButton>
        </div>

        {tab === "net" ? (
          <>
            {commodityOptions.length > 0 && (
              <CommodityFilterBar
                commodities={commodityOptions}
                value={commodityFilter}
                onChange={setCommodityFilter}
              />
            )}
            <NetPositionPanel canEdit commodityFilter={commodityFilter} />
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
      void utils.trader.seasonNetPositions.invalidate();
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
        Default rate for converting in/(out)-of-the-money PKR to USD on the Net Position tab. A
        column-specific FX saved on that tab overrides this for that column only.
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
            <p className="text-xs text-amber-700">
              No default FX saved yet — USD columns stay blank until you publish one or set FX per column on
              the Net Position tab.
            </p>
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

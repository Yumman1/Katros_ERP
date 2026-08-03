"use client";

import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";

import { useMemo, useState } from "react";
import { formatPkDateTime, pkToday } from "@/lib/formatters/datetime";

type RowDraft = {
  cnf: string;
  cnfCurrency: string;
  cnfUnit: string;
  yesterdayRate: string;
  yesterdayCurrency: string;
  yesterdayUnit: string;
};

function parseOptionalPositive(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function ExecutionDailyPricesPage() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.market.dailyPrices.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: options } = trpc.market.options.useQuery();
  const upsert = trpc.market.upsertDailyPrice.useMutation({
    onSuccess: () => {
      void utils.market.dailyPrices.invalidate();
      void utils.market.snapshot.invalidate();
      // The net position values itself at today's rate — republish it too.
      void utils.trader.seasonNetPositions.invalidate();
    },
  });

  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const today = pkToday();

  const currencies = options?.currencies ?? ["USD", "PKR", "MYR"];
  const units = options?.units ?? ["MT", "KG", "MAUND_40", "MAUND_37"];

  const draftFor = (row: NonNullable<typeof rows>[number]): RowDraft => {
    const existing = drafts[row.code];
    if (existing) return existing;
    return {
      cnf: row.cnf != null ? String(row.cnf) : "",
      cnfCurrency: row.cnfCurrency,
      cnfUnit: row.cnfUnit,
      yesterdayRate: row.yesterdayRate != null ? String(row.yesterdayRate) : "",
      yesterdayCurrency: row.yesterdayCurrency,
      yesterdayUnit: row.yesterdayUnit,
    };
  };

  const setDraft = (code: string, patch: Partial<RowDraft>) => {
    const row = rows?.find((r) => r.code === code);
    if (!row) return;
    setDrafts((prev) => ({
      ...prev,
      [code]: { ...draftFor(row), ...patch },
    }));
  };

  const onSave = (code: string) => {
    const row = rows?.find((r) => r.code === code);
    if (!row) return;
    const d = draftFor(row);
    const cnfRaw = d.cnf.trim();
    const yRaw = d.yesterdayRate.trim();
    const hasCnf = row.cnf != null;
    const hasYesterday = row.yesterdayRate != null;

    const payload: {
      code: string;
      priceDate: string;
      cnf?: number | null;
      cnfCurrency?: string | null;
      cnfUnit?: string | null;
      yesterdayRate?: number | null;
      yesterdayCurrency?: string | null;
      yesterdayUnit?: string | null;
    } = { code, priceDate: today };

    if (cnfRaw !== "") {
      const v = parseOptionalPositive(cnfRaw);
      if (!v) {
        setFormError(`Enter a valid CNF rate for ${code}.`);
        return;
      }
      payload.cnf = v;
      payload.cnfCurrency = d.cnfCurrency;
      payload.cnfUnit = d.cnfUnit;
    } else if (hasCnf) {
      payload.cnf = null;
    }

    if (yRaw !== "") {
      const v = parseOptionalPositive(yRaw);
      if (!v) {
        setFormError(`Enter a valid yesterday rate for ${code}.`);
        return;
      }
      payload.yesterdayRate = v;
      payload.yesterdayCurrency = d.yesterdayCurrency;
      payload.yesterdayUnit = d.yesterdayUnit;
    } else if (hasYesterday) {
      payload.yesterdayRate = null;
    }

    if (payload.cnf === undefined && payload.yesterdayRate === undefined) {
      setFormError("Enter CNF and/or yesterday rate before publishing.");
      return;
    }

    setFormError(null);
    upsert.mutate(payload, {
      onSuccess: () => {
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[code];
          return next;
        });
      },
      onError: (err) => setFormError(err.message),
    });
  };

  const publishedCount = useMemo(
    () => rows?.filter((r) => r.cnf != null || r.yesterdayRate != null).length ?? 0,
    [rows],
  );

  return (
    <DeskPage>
      <DeskScroll className="space-y-5 pb-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Daily Market Prices</h1>
        <p className="text-sm text-muted-foreground">
          Enter CNF (optional) and yesterday&apos;s local price per commodity, then click{" "}
          <strong className="text-foreground">Publish</strong> on that row. CNF and yesterday can use
          different currencies and units.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {publishedCount} of {rows?.length ?? 0} commodities with desk prices ({today})
        </p>
        {(formError || upsert.error) && (
          <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError ?? upsert.error?.message}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading commodities…</div>
      ) : !rows?.length ? (
        <div className="exec-empty py-10">
          No commodities registered yet. Add commodities on the trader desk first, then return here to
          publish daily prices.
        </div>
      ) : (
        <div className="kastros-table-wrap">
          <table className="kastros-table min-w-[1100px] text-sm">
            <thead>
              <tr>
                <th rowSpan={2}>Commodity</th>
                <th colSpan={3}>CNF (optional)</th>
                <th colSpan={3}>Yesterday local</th>
                <th rowSpan={2}>Published</th>
                <th rowSpan={2} />
              </tr>
              <tr>
                <th>Rate</th>
                <th>CCY</th>
                <th>Unit</th>
                <th>Rate</th>
                <th>CCY</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const d = draftFor(row);
                const hasCnf = row.cnf != null;
                const hasYesterday = row.yesterdayRate != null;
                const canSave = d.cnf.trim() !== "" || d.yesterdayRate.trim() !== "";
                return (
                  <tr key={row.code}>
                    <td>
                      <div className="font-medium text-foreground">{row.code}</div>
                      <div className="text-xs text-muted-foreground">{row.name}</div>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={hasCnf ? String(row.cnf) : "Optional"}
                        value={d.cnf}
                        onChange={(e) => setDraft(row.code, { cnf: e.target.value })}
                        className="kastros-input kastros-input-sm w-24 data-grid"
                      />
                    </td>
                    <td>
                      <select
                        value={d.cnfCurrency}
                        onChange={(e) => setDraft(row.code, { cnfCurrency: e.target.value })}
                        className="kastros-select kastros-select-sm"
                      >
                        {currencies.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={d.cnfUnit}
                        onChange={(e) => setDraft(row.code, { cnfUnit: e.target.value })}
                        className="kastros-select kastros-select-sm"
                      >
                        {units.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={hasYesterday ? String(row.yesterdayRate) : "Local"}
                        value={d.yesterdayRate}
                        onChange={(e) => setDraft(row.code, { yesterdayRate: e.target.value })}
                        className="kastros-input kastros-input-sm w-24 data-grid"
                      />
                    </td>
                    <td>
                      <select
                        value={d.yesterdayCurrency}
                        onChange={(e) => setDraft(row.code, { yesterdayCurrency: e.target.value })}
                        className="kastros-select kastros-select-sm"
                      >
                        {currencies.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={d.yesterdayUnit}
                        onChange={(e) => setDraft(row.code, { yesterdayUnit: e.target.value })}
                        className="kastros-select kastros-select-sm"
                      >
                        {units.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {hasCnf || hasYesterday ? (
                        <>
                          {hasCnf && (
                            <div className="font-medium text-foreground">
                              CNF {formatCurrency(row.cnf!, row.cnfCurrency)} / {row.cnfUnit}
                            </div>
                          )}
                          {hasYesterday && (
                            <div className="font-medium text-foreground">
                              Yday {formatCurrency(row.yesterdayRate!, row.yesterdayCurrency)} /{" "}
                              {row.yesterdayUnit}
                            </div>
                          )}
                          <div className="mt-1 text-muted-foreground">
                            {formatPkDateTime(row.updatedAt, "")}
                            {row.updatedBy ? ` · ${row.updatedBy}` : ""}
                          </div>
                        </>
                      ) : (
                        "Not set"
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={upsert.isPending || !canSave}
                        onClick={() => onSave(row.code)}
                        className="kastros-btn-primary px-3 py-1.5 text-xs disabled:opacity-40"
                      >
                        Publish
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </DeskScroll>
    </DeskPage>
  );
}

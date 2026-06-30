"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";
import { format } from "date-fns";
import { useMemo, useState } from "react";

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
    refetchInterval: 15_000,
  });
  const { data: options } = trpc.market.options.useQuery();
  const upsert = trpc.market.upsertDailyPrice.useMutation({
    onSuccess: () => {
      void utils.market.dailyPrices.invalidate();
      void utils.market.snapshot.invalidate();
    },
  });

  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const today = format(new Date(), "yyyy-MM-dd");

  const currencies = options?.currencies ?? ["USD", "PKR", "MYR"];
  const units = options?.units ?? ["MT", "KG", "MAUND"];

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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-white">Daily Market Prices</h1>
        <p className="text-sm text-zinc-500">
          CNF is optional — only enter it where you have an import/CNF level. Yesterday&apos;s local price can use a
          different currency and unit (e.g. CNF in USD/MT, yesterday in PKR/MT).
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          {publishedCount} of {rows?.length ?? 0} commodities with desk prices ({today})
        </p>
        {(formError || upsert.error) && (
          <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {formError ?? upsert.error?.message}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="text-zinc-500">Loading commodities…</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02]">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="border-b border-white/10 px-3 py-3">Commodity</th>
                <th className="border-b border-white/10 px-3 py-3" colSpan={3}>
                  CNF (optional)
                </th>
                <th className="border-b border-white/10 px-3 py-3" colSpan={3}>
                  Yesterday local
                </th>
                <th className="border-b border-white/10 px-3 py-3">Published</th>
                <th className="border-b border-white/10 px-3 py-3" />
              </tr>
              <tr>
                <th className="border-b border-white/10 px-3 py-2" />
                <th className="border-b border-white/10 px-3 py-2">Rate</th>
                <th className="border-b border-white/10 px-3 py-2">CCY</th>
                <th className="border-b border-white/10 px-3 py-2">Unit</th>
                <th className="border-b border-white/10 px-3 py-2">Rate</th>
                <th className="border-b border-white/10 px-3 py-2">CCY</th>
                <th className="border-b border-white/10 px-3 py-2">Unit</th>
                <th className="border-b border-white/10 px-3 py-2">Last update</th>
                <th className="border-b border-white/10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows?.map((row) => {
                const d = draftFor(row);
                const hasCnf = row.cnf != null;
                const hasYesterday = row.yesterdayRate != null;
                const canSave =
                  d.cnf.trim() !== "" || d.yesterdayRate.trim() !== "";
                return (
                  <tr key={row.code} className="border-b border-white/5">
                    <td className="px-3 py-3">
                      <div className="font-medium text-white">{row.code}</div>
                      <div className="text-xs text-zinc-500">{row.name}</div>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        step="0.01"
                        placeholder={hasCnf ? String(row.cnf) : "Optional"}
                        value={d.cnf}
                        onChange={(e) => setDraft(row.code, { cnf: e.target.value })}
                        className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm text-white data-grid"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={d.cnfCurrency}
                        onChange={(e) => setDraft(row.code, { cnfCurrency: e.target.value })}
                        className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm text-white"
                      >
                        {currencies.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={d.cnfUnit}
                        onChange={(e) => setDraft(row.code, { cnfUnit: e.target.value })}
                        className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm text-white"
                      >
                        {units.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        step="0.01"
                        placeholder={hasYesterday ? String(row.yesterdayRate) : "Local"}
                        value={d.yesterdayRate}
                        onChange={(e) => setDraft(row.code, { yesterdayRate: e.target.value })}
                        className="w-24 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm text-white data-grid"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={d.yesterdayCurrency}
                        onChange={(e) => setDraft(row.code, { yesterdayCurrency: e.target.value })}
                        className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm text-white"
                      >
                        {currencies.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={d.yesterdayUnit}
                        onChange={(e) => setDraft(row.code, { yesterdayUnit: e.target.value })}
                        className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm text-white"
                      >
                        {units.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-500 whitespace-nowrap">
                      {hasCnf || hasYesterday ? (
                        <>
                          {hasCnf && (
                            <div>
                              CNF {formatCurrency(row.cnf!, row.cnfCurrency)} / {row.cnfUnit}
                            </div>
                          )}
                          {hasYesterday && (
                            <div className="text-zinc-400">
                              Yday {formatCurrency(row.yesterdayRate!, row.yesterdayCurrency)} /{" "}
                              {row.yesterdayUnit}
                            </div>
                          )}
                          <div className="mt-1 text-zinc-600">
                            {row.updatedAt ? row.updatedAt.slice(0, 16).replace("T", " ") : ""}
                            {row.updatedBy ? ` · ${row.updatedBy}` : ""}
                          </div>
                        </>
                      ) : (
                        "Not set"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        disabled={upsert.isPending || !canSave}
                        onClick={() => onSave(row.code)}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
                        style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}
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
    </div>
  );
}

"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/lib/formatters/numbers";

export default function TraderMarketPage() {
  const commodities = trpc.commodity.list.useQuery();
  const prices = [
    { code: "WHT", price: 281.4, chg: 0.82 },
    { code: "CPO", price: 935.2, chg: -0.31 },
    { code: "SUG", price: 468.75, chg: 1.1 },
    { code: "SOY", price: 441.25, chg: 0.45 },
    { code: "RCE", price: 518.0, chg: -0.12 },
    { code: "CRN", price: 201.5, chg: 0.28 },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-white">Market Watch</h1>
        <p className="text-sm text-zinc-500">Live reference prices for commodities you trade.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {prices.map((p) => {
          const meta = commodities.data?.find((c) => c.code === p.code);
          return (
            <div key={p.code} className="rounded-lg border border-kastros-border bg-kastros-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-semibold text-white">{p.code}</div>
                  <div className="text-xs text-zinc-500">{meta?.name ?? p.code}</div>
                </div>
                <span
                  className={`text-xs font-medium ${p.chg >= 0 ? "text-kastros-green" : "text-kastros-red"}`}
                >
                  {p.chg >= 0 ? "+" : ""}
                  {p.chg.toFixed(2)}%
                </span>
              </div>
              <div className="mt-3 data-grid text-2xl font-medium text-white">
                {formatCurrency(p.price)}
                <span className="ml-1 text-sm text-zinc-500">/ MT</span>
              </div>
              {meta?.exchange && (
                <div className="mt-2 text-xs text-zinc-600">{meta.exchange} · {meta.tickerCode}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

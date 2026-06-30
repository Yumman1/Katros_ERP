"use client";

import { useEffect, useState } from "react";
import { formatQty } from "@/lib/formatters/numbers";

type Tick = { code: string; price: number; ccy: string; unit?: string; chgPct?: number };

export function PriceTicker() {
  const [ticks, setTicks] = useState<Tick[]>([]);

  useEffect(() => {
    const es = new EventSource("/api/sse/prices");
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as Tick[];
        setTicks(data);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, []);

  if (!ticks.length) {
    return (
      <div className="animate-pulse truncate text-xs text-zinc-500">
        Desk prices not published yet
      </div>
    );
  }

  return (
    <div className="flex gap-6 overflow-x-auto whitespace-nowrap text-xs">
      {ticks.map((t) => (
        <span key={t.code} className="font-mono text-zinc-300">
          <span className="font-semibold text-white">{t.code}</span>{" "}
          <span className="text-kastros-green">
            {t.ccy} {formatQty(t.price, 2)}
            {t.unit ? `/${t.unit}` : ""}
          </span>
          {t.chgPct != null && (
            <span className={t.chgPct >= 0 ? "text-kastros-green" : "text-kastros-red"}>
              {" "}
              ({t.chgPct >= 0 ? "+" : ""}
              {t.chgPct.toFixed(2)}%)
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

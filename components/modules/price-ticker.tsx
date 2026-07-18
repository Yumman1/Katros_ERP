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
      <div className="animate-pulse truncate text-xs text-subtle">
        Desk prices not published yet
      </div>
    );
  }

  return (
    <div className="flex gap-6 overflow-x-auto whitespace-nowrap text-xs">
      {ticks.map((t) => (
        <span key={t.code} className="font-mono text-muted-foreground">
          <span className="font-semibold text-foreground">{t.code}</span>{" "}
          <span className="text-accent">
            {t.ccy} {formatQty(t.price, 2)}
            {t.unit ? `/${t.unit}` : ""}
          </span>
          {t.chgPct != null && (
            <span className={t.chgPct >= 0 ? "text-success" : "text-destructive"}>
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

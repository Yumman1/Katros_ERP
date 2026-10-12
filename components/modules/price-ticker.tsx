"use client";

import { useEffect, useMemo, useState } from "react";
import { formatQty } from "@/lib/formatters/numbers";
import { compareTickerTicks, tickerSymbol } from "@/lib/desk-market-price-meta";

type Tick = { code: string; season?: string; price: number; ccy: string; unit?: string; chgPct?: number };

export function PriceTicker({ preferCode }: { preferCode?: string }) {
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

  const ordered = useMemo(
    () => [...ticks].sort((a, b) => compareTickerTicks(a, b, preferCode)),
    [ticks, preferCode],
  );

  if (!ordered.length) {
    return (
      <div className="animate-pulse truncate text-xs text-subtle">
        Desk prices not published yet
      </div>
    );
  }

  return (
    <div className="flex gap-6 overflow-x-auto whitespace-nowrap text-xs">
      {ordered.map((t) => (
        <span key={`${t.code}-${t.season ?? ""}`} className="font-mono text-muted-foreground">
          <span className="font-semibold text-foreground">{tickerSymbol(t.code, t.season)}</span>{" "}
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

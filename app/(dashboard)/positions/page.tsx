"use client";

import { useState } from "react";
import { NetPositionPanel } from "@/components/position/net-position-panel";
import TraderExposureDashboard from "@/components/position/trader-exposure-dashboard";
import { cn } from "@/lib/utils";

type View = "trader" | "execution";

export default function PositionsPage() {
  const [view, setView] = useState<View>("trader");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <nav aria-label="Finance position views" className="flex shrink-0 flex-wrap gap-2">
        {([ ["trader", "Trader positions"], ["execution", "Execution positions"] ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={view === key}
            className={cn("rounded-lg border px-4 py-2 text-sm", view === key ? "border-brand bg-brand/10 text-foreground" : "border-border text-muted-foreground hover:bg-foreground/5")}
            onClick={() => setView(key)}>{label}</button>
        ))}
      </nav>
      {view === "trader" ? <TraderExposureDashboard /> : (
        <div className="min-h-0 flex-1 space-y-4 overflow-auto pb-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Execution positions</h1>
            <p className="text-sm text-subtle">Open purchases and sales, warehouse inventory, and net position by commodity and crop season.</p>
          </div>
          <NetPositionPanel canEdit={false} />
        </div>
      )}
    </div>
  );
}

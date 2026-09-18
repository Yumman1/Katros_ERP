"use client";

import { useMemo, useState } from "react";
import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import { NetPositionPanel } from "@/components/position/net-position-panel";
import { collectCommodityOptions } from "@/lib/execution-commodity-filter";
import { trpc } from "@/lib/trpc/client";

export default function PositionsPage() {
  const [commodityFilter, setCommodityFilter] = useState("ALL");
  const { data: seasonCols } = trpc.trader.seasonNetPositions.useQuery();
  const commodityOptions = useMemo(
    () => collectCommodityOptions((seasonCols ?? []).map((c) => ({
      commodityCode: c.commodityCode,
      commodityName: c.commodityName,
    }))),
    [seasonCols],
  );

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto pb-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Positions</h1>
        <p className="text-sm text-subtle">Open purchases and sales, warehouse inventory, and net position by commodity and crop season.</p>
      </div>
      {commodityOptions.length > 0 && (
        <CommodityFilterBar commodities={commodityOptions} value={commodityFilter} onChange={setCommodityFilter} />
      )}
      <NetPositionPanel canEdit={false} commodityFilter={commodityFilter} />
    </div>
  );
}

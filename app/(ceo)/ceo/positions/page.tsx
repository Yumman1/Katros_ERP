"use client";

import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { NetPositionPanel } from "@/components/position/net-position-panel";
import { CommodityFilterBar } from "@/components/execution/commodity-filter-bar";
import { collectCommodityOptions } from "@/lib/execution-commodity-filter";
import { trpc } from "@/lib/trpc/client";
import { useMemo, useState } from "react";

export default function CeoPositionsPage() {
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
            Net position by commodity and crop season — open purchases and sales still on paper,
            plus what the warehouses hold.
          </p>
        </div>

        {commodityOptions.length > 0 && (
          <CommodityFilterBar
            commodities={commodityOptions}
            value={commodityFilter}
            onChange={setCommodityFilter}
          />
        )}

        <NetPositionPanel canEdit commodityFilter={commodityFilter} />
      </DeskScroll>
    </DeskPage>
  );
}

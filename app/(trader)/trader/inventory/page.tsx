"use client";

import { useCommodityDesk } from "@/components/trader/commodity-desk-provider";
import { InventoryStatistics } from "@/components/execution/inventory-statistics";
import { SesameInventoryView, SesamePakistanInventoryExtras } from "@/components/execution/sesame-entity-panels";
import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { isSesameCommodity } from "@/lib/sesame";

export default function TraderInventoryPage() {
  const desk = useCommodityDesk();
  const entity = desk.entity;
  const active = desk.active;

  if (!active) {
    return (
      <DeskPage>
        <DeskScroll className="space-y-3 pb-6">
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {desk.loading ? "Loading commodity desk…" : "No assigned commodities."}
          </p>
        </DeskScroll>
      </DeskPage>
    );
  }

  const sesame = isSesameCommodity(active.code);
  if (sesame && entity === "FZCO") {
    return (
      <SesameInventoryView
        key={`${active.code}-FZCO`}
        commodityCode={active.code}
        entity="FZCO"
        onSelectEntity={desk.selectEntity}
      />
    );
  }

  return (
    <InventoryStatistics
      key={active.id}
      commodityId={active.id}
      commodityCode={active.code}
      movementsHref="/trader/fulfillment"
      warehousesHref="/trader/inventory"
      showWarehouseSetup={false}
    >
      {sesame ? (
        <SesamePakistanInventoryExtras commodityCode={active.code} onSelectEntity={desk.selectEntity} />
      ) : null}
    </InventoryStatistics>
  );
}

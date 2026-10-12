"use client";

import { useState } from "react";
import { useCommodityDesk } from "@/components/trader/commodity-desk-provider";
import { SesameInventoryView } from "@/components/execution/sesame-entity-panels";
import { DeskPage, DeskScroll } from "@/components/layout/desk-page";
import { isSesameCommodity } from "@/lib/sesame";
import type { SesameEntity } from "@/lib/sesame-entity";

export default function TraderInventoryPage() {
  const desk = useCommodityDesk();
  const [entity, setEntity] = useState<SesameEntity>("PAK");
  const code = desk.active?.code ?? "";

  if (!code || !isSesameCommodity(code)) {
    return (
      <DeskPage>
        <DeskScroll className="space-y-3 pb-6">
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Switch to the Sesame dashboard to view warehouse stock, ownership, and free-to-sell quantities.
          </p>
        </DeskScroll>
      </DeskPage>
    );
  }

  return (
    <SesameInventoryView
      key={code}
      commodityCode={code}
      entity={entity}
      onSelectEntity={setEntity}
    />
  );
}

"use client";

import { ExecutionProfileDesk } from "@/components/execution/execution-profile-desk";
import type { TradeScope } from "@/lib/trade-constants";
import Link from "next/link";

export function PurchaseSpotDesk({ scope }: { scope: TradeScope }) {
  return (
    <ExecutionProfileDesk
      scope={scope}
      config={{
        profile: "PURCHASE_SPOT",
        movementType: "INBOUND",
        workflow: "purchase-spot",
        title: "Gate In — Spot Purchases",
        subtitle: "Allocate gate trucks to spot orders · mandi / DC / invoice workflow per trade",
        detailBasePath: "/execution/purchase-spot",
        accentVariant: "info",
        openOrdersLabel: "Open spot orders",
        openOrdersVariant: "info",
        showSpotExtras: true,
        inventoryFooter: (
          <>
            Allocated receipts update{" "}
            <Link href="/execution/inventory" className="text-accent-secondary hover:underline">
              Inventory
            </Link>
            . Spot workflow steps are on each trade detail page.
          </>
        ),
      }}
    />
  );
}

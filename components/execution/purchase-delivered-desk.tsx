"use client";

import { ExecutionProfileDesk } from "@/components/execution/execution-profile-desk";
import type { TradeScope } from "@/lib/trade-constants";
import Link from "next/link";

export function PurchaseDeliveredDesk({ scope }: { scope: TradeScope }) {
  return (
    <ExecutionProfileDesk
      scope={scope}
      config={{
        profile: "PURCHASE_DELIVERED",
        movementType: "INBOUND",
        warehouseAllocated: true,
        workflow: "purchase-delivered",
        title: "Gate In — Purchases",
        subtitle:
          "Trucks from the warehouse gate · assign to open purchase orders (every incoterm except Spot)",
        detailBasePath: "/execution/purchase-delivered",
        accentVariant: "success",
        openOrdersLabel: "Open purchase orders",
        openOrdersVariant: "success",
        inventoryFooter: (
          <>
            Allocated receipts update{" "}
            <Link href="/execution/inventory" className="text-accent-secondary hover:underline">
              Inventory
            </Link>{" "}
            for that warehouse and commodity.
          </>
        ),
      }}
    />
  );
}

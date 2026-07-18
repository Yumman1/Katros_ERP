"use client";

import { ExecutionProfileDesk } from "@/components/execution/execution-profile-desk";
import type { TradeScope } from "@/lib/trade-constants";
import Link from "next/link";

export function SalesDesk({ scope }: { scope: TradeScope }) {
  return (
    <ExecutionProfileDesk
      scope={scope}
      config={{
        profile: "SALE_EX_WAREHOUSE",
        movementType: "OUTBOUND",
        warehouseAllocated: true,
        workflow: "sales",
        title: "Gate Out — Sales",
        subtitle: "Trucks leaving the warehouse · assign to open sale orders (all incoterms)",
        detailBasePath: "/execution/sales",
        accentVariant: "warning",
        openOrdersLabel: "Open sale orders",
        openOrdersVariant: "accent",
        inventoryFooter: (
          <>
            Allocated dispatches update{" "}
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

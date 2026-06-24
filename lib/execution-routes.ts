import type { ExecutionProfile } from "@/lib/trade-constants";

export function executionWorkspacePath(
  tradeRef: string,
  profile: string | null | undefined,
): string {
  const ref = encodeURIComponent(tradeRef);
  switch (profile) {
    case "PURCHASE_DELIVERED":
      return `/execution/purchase-delivered/${ref}`;
    case "PURCHASE_SPOT":
      return `/execution/purchase-spot/${ref}`;
    case "SALE_EX_WAREHOUSE":
      return `/execution/sales/${ref}`;
    default:
      return `/execution/contracts`;
  }
}

export function profileFromTrade(
  direction: "BUY" | "SELL",
  buyingCategory?: string | null,
): ExecutionProfile {
  if (direction === "SELL") return "SALE_EX_WAREHOUSE";
  return buyingCategory === "Spot" ? "PURCHASE_SPOT" : "PURCHASE_DELIVERED";
}

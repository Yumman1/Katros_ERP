import { tradeEntity } from "@/lib/sesame-entity";
import { sesameGrade } from "@/lib/sesame-processing";
import { quantityUnitToKg } from "@/lib/unit-conversion";

const n = (v: unknown) => Number(v ?? 0);

export type SaleReservation = {
  tradeRef: string;
  direction: string;
  tradeParams: unknown;
  quantity: unknown;
  quantityUnit: string;
  contract: {
    contractStatus: string | null;
    openQtyMt: unknown;
    quantityUnit: string;
    warehouseAllocations: { warehouseName: string; qtyMt: unknown; fulfilledQtyMt: unknown }[];
  } | null;
};

/** Pakistan warehouse sales, including a legacy FZCO-from-Pakistan purchase that was not rewritten. */
export function isPakistanPhysicalSale(direction: string, params: unknown): boolean {
  const entity = tradeEntity(params);
  const internal = (params as Record<string, unknown> | null)?.internalCounterpartyEntity;
  return (direction === "SELL" && entity === "PAK") || (direction === "BUY" && entity === "FZCO" && internal === "PAK");
}

function warehouseSelections(params: unknown): string[] {
  return String((params as Record<string, unknown> | null)?.warehouseSelections ?? "")
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sameWarehouse(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Remaining kg this Pakistan sale has claimed at one warehouse.
 * Unallocated sales (no split and no warehouse pick) are not pinned to every
 * warehouse — they show as unassigned booked until execution allocates them.
 */
export function bookedPakistanSaleKgAtWarehouse(
  t: SaleReservation,
  warehouse: string,
  grade?: string,
  excludeTradeRef?: string,
): number {
  if (excludeTradeRef && t.tradeRef === excludeTradeRef) return 0;
  if (!isPakistanPhysicalSale(t.direction, t.tradeParams) || t.contract?.contractStatus === "Close") return 0;
  if (grade && sesameGrade(t.tradeParams) !== grade) return 0;
  const c = t.contract;
  const unit = c?.quantityUnit ?? t.quantityUnit;
  if (c?.warehouseAllocations.length) {
    return c.warehouseAllocations
      .filter((a) => sameWarehouse(a.warehouseName, warehouse))
      .reduce((s, a) => s + quantityUnitToKg(Math.max(0, n(a.qtyMt) - n(a.fulfilledQtyMt)), unit), 0);
  }
  if (warehouseSelections(t.tradeParams).some((name) => sameWarehouse(name, warehouse))) {
    return quantityUnitToKg(c ? n(c.openQtyMt) : n(t.quantity), unit);
  }
  return 0;
}

export function unassignedPakistanSaleMt(t: SaleReservation): number {
  if (!isPakistanPhysicalSale(t.direction, t.tradeParams) || t.contract?.contractStatus === "Close") return 0;
  if (t.contract?.warehouseAllocations.length || warehouseSelections(t.tradeParams).length) return 0;
  return Math.max(0, t.contract ? n(t.contract.openQtyMt) : n(t.quantity));
}

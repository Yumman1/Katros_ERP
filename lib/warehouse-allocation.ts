import { openQtyEpsilon } from "@/lib/unit-conversion";

export type WarehouseAllocationLine = {
  warehouseName: string;
  qtyMt: number;
};

export type WarehouseAllocationContract = {
  contractualQtyMt: number;
  quantityUnit: string;
  contractStatus?: string;
  allocatedWarehouse?: string | null;
  warehouseAllocations?: WarehouseAllocationLine[] | null;
};

export function normWarehouseName(s: string): string {
  return s.trim().toLowerCase();
}

/** Migrate legacy single-warehouse field into split lines when needed. */
export function resolveWarehouseAllocations(
  c: WarehouseAllocationContract,
): WarehouseAllocationLine[] {
  const lines = (c.warehouseAllocations ?? []).filter(
    (a) => a.warehouseName?.trim() && a.qtyMt > 0,
  );
  if (lines.length) return lines;
  const legacy = c.allocatedWarehouse?.trim();
  if (legacy) {
    return [{ warehouseName: legacy, qtyMt: c.contractualQtyMt }];
  }
  return [];
}

export function contractHasWarehouseAllocation(c: WarehouseAllocationContract): boolean {
  return resolveWarehouseAllocations(c).length > 0;
}

export function contractMatchesWarehouse(
  c: WarehouseAllocationContract,
  warehouseName: string,
): boolean {
  const wh = normWarehouseName(warehouseName);
  return resolveWarehouseAllocations(c).some(
    (a) => normWarehouseName(a.warehouseName) === wh,
  );
}

export function allocationQtyAtWarehouse(
  c: WarehouseAllocationContract,
  warehouseName: string,
): number {
  const wh = normWarehouseName(warehouseName);
  return resolveWarehouseAllocations(c)
    .filter((a) => normWarehouseName(a.warehouseName) === wh)
    .reduce((s, a) => s + a.qtyMt, 0);
}

export function allocationQtySum(c: WarehouseAllocationContract): number {
  return resolveWarehouseAllocations(c).reduce((s, a) => s + a.qtyMt, 0);
}

export function allocationSummaryLabel(
  c: WarehouseAllocationContract,
  unit = c.quantityUnit,
): string {
  const lines = resolveWarehouseAllocations(c);
  if (!lines.length) return "—";
  if (lines.length === 1) return lines[0]!.warehouseName;
  return lines.map((a) => `${a.warehouseName} (${a.qtyMt} ${unit})`).join(" + ");
}

export function openQtyAtWarehouse(
  allocatedQty: number,
  fulfilledQty: number,
  _unit: string,
): number {
  return Math.max(0, allocatedQty - fulfilledQty);
}

export function allocationsSumMatchesContract(
  sumQty: number,
  contractualQty: number,
  unit: string,
): boolean {
  return Math.abs(sumQty - contractualQty) <= openQtyEpsilon(unit);
}

export type WarehouseOpenAllocationLine = {
  warehouseName: string;
  /** Remaining qty to receive/dispatch at this warehouse (not yet fulfilled). */
  openQtyMt: number;
};

export type WarehouseAllocationProgressLike = {
  warehouseName: string;
  qtyMt: number;
  fulfilledQtyMt: number;
  openQtyMt: number;
};

/** Share of total contract qty allocated to a warehouse. */
export function warehouseShareOfOrder(
  qtyMt: number,
  contractualQtyMt: number,
): number {
  if (contractualQtyMt <= 0) return 0;
  return (qtyMt / contractualQtyMt) * 100;
}

export const TRADER_WAREHOUSE_SELECTIONS_KEY = "warehouseSelections";

/** Parse trader warehouse picks from tradeParams (pipe-separated or legacy single `warehouse`). */
export function parseTraderWarehouseSelections(
  tradeParams?: Record<string, string | number | null | undefined> | null,
): string[] {
  if (!tradeParams) return [];
  const raw = tradeParams[TRADER_WAREHOUSE_SELECTIONS_KEY] ?? tradeParams.warehouse;
  if (raw == null || raw === "") return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.includes("|")) {
    return [...new Set(s.split("|").map((x) => x.trim()).filter(Boolean))];
  }
  return [s];
}

export function serializeTraderWarehouseSelections(names: string[]): string {
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))].join("|");
}

export function formatTraderWarehouseSelections(names: string[]): string | null {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0]!;
  return clean.join(" + ");
}

/** Open-trade warehouse split plan stored in tradeParams until lock. */
export const EXECUTION_WAREHOUSE_SPLIT_KEY = "executionWarehouseSplit";

/** Serialized as "Warehouse A:500|Warehouse B:300" (open qty in MT). */
export function parseExecutionWarehouseSplit(
  tradeParams?: Record<string, string | number | null | undefined> | null,
): WarehouseOpenAllocationLine[] {
  if (!tradeParams) return [];
  const raw = tradeParams[EXECUTION_WAREHOUSE_SPLIT_KEY];
  if (raw == null || raw === "") return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s
    .split("|")
    .map((part) => {
      const idx = part.lastIndexOf(":");
      if (idx <= 0) return null;
      const warehouseName = part.slice(0, idx).trim();
      const openQtyMt = parseFloat(part.slice(idx + 1));
      if (!warehouseName || !Number.isFinite(openQtyMt) || openQtyMt < 0) return null;
      return { warehouseName, openQtyMt };
    })
    .filter((x): x is WarehouseOpenAllocationLine => x != null);
}

export function serializeExecutionWarehouseSplit(lines: WarehouseOpenAllocationLine[]): string {
  return lines
    .filter((l) => l.warehouseName.trim() && l.openQtyMt > 0)
    .map((l) => `${l.warehouseName.trim()}:${l.openQtyMt}`)
    .join("|");
}

/**
 * Warehouse lines written when a trade is locked.
 * Delivered / ex-warehouse still need an approved split. Spot / Moqa / Ex-Works
 * is only a delivery term — if a yard was picked (split, trader selection, or
 * dest), persist it so inbound stock stays on that trade.
 */
export function lockWarehouseAllocationLines(input: {
  paperOwnership: boolean;
  requiresWarehouse: boolean;
  warehouseSplitApproved?: boolean;
  profile: string;
  splitPlan: WarehouseOpenAllocationLine[];
  traderSelections: string[];
  destName?: string | null;
  qtyMt: number;
  resolveName: (hint: string) => string | null;
}): WarehouseAllocationLine[] {
  if (input.paperOwnership || !(input.qtyMt > 0)) return [];
  const fromSplit =
    input.splitPlan.length > 0 &&
    (!input.requiresWarehouse || input.warehouseSplitApproved !== false);
  if (fromSplit) {
    return input.splitPlan
      .map((line) => ({
        warehouseName: input.resolveName(line.warehouseName) ?? line.warehouseName.trim(),
        qtyMt: line.openQtyMt,
      }))
      .filter((line) => line.warehouseName && line.qtyMt > 0);
  }
  if (input.profile !== "PURCHASE_SPOT") return [];
  const hint = input.traderSelections.find((n) => n.trim()) ?? input.destName?.trim();
  if (!hint) return [];
  const warehouseName = input.resolveName(hint) ?? hint;
  if (!warehouseName.trim()) return [];
  return [{ warehouseName, qtyMt: input.qtyMt }];
}

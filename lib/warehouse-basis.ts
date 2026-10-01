import { z } from "zod";

export const warehouseBasisSchema = z.enum(["LEASE", "USE"]);
export type WarehouseBasis = z.infer<typeof warehouseBasisSchema>;
export const USE_BASIS_MESSAGE = "Use basis · confirm space by phone before storing inventory";

export function validateWarehouseCapacity(input: {
  warehouseBasis?: WarehouseBasis;
  capacitySqFt?: number | null;
  grainDivisionSqFt?: number | null;
  balesDivisionSqFt?: number | null;
}) {
  warehouseBasisSchema.parse(input.warehouseBasis ?? "LEASE");
  if (input.warehouseBasis === "USE") return;
  if (!Number.isFinite(input.capacitySqFt) || (input.capacitySqFt ?? 0) <= 0) {
    throw new Error("Lease-basis warehouses require a positive capacity in square feet.");
  }
  for (const value of [input.grainDivisionSqFt, input.balesDivisionSqFt]) {
    if (value != null && (!Number.isFinite(value) || value <= 0)) {
      throw new Error("Storage divisions must be positive numbers.");
    }
  }
}

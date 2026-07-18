import { z } from "zod";

const qualitySchema = z.object({
  damagePct: z.coerce.number().min(0),
  brokenPct: z.coerce.number().min(0),
  fungusPct: z.coerce.number().min(0),
  foreignMatterPct: z.coerce.number().min(0),
  moisturePct: z.coerce.number().min(0),
});

export const gatepassSchema = z.object({
  movementType: z.enum(["INBOUND", "OUTBOUND"]),
  counterpartyName: z.string().trim().min(1, "Counterparty is required"),
  warehouseName: z.string().trim().min(1, "Warehouse is required"),
  truckNo: z.string().trim().min(1, "Truck number is required"),
  transporterName: z.string().trim().optional(),
  transporterPhone: z.string().trim().optional(),
  builtyDetails: z.string().trim().min(1, "Builty number is required").regex(/^\d+$/, "Builty number must be numeric"),
  commodityCode: z.string().trim().min(1, "Commodity is required"),
  commodityName: z.string().trim().min(1, "Commodity is required"),
  recordedByName: z.string().trim().min(1, "Your name is required"),
  quantityAsPerBuilty: z.string().trim().optional(),
  weightAsPerBuiltyKg: z.coerce.number().positive("Weight as per seller must be greater than 0"),
  weighBridgeName: z.string().trim().optional(),
  documentRefs: z.array(z.string().trim().min(1)).optional(),
  warehouseWeightKg: z.coerce.number().min(0).optional(),
  qualitySpecs: qualitySchema.optional(),
  quantityBagsBales: z.coerce.number().min(0).optional(),
  totalDeductionsKg: z.coerce.number().min(0).optional(),
  remarks: z.string().trim().optional(),
});

export type GatepassPayload = z.infer<typeof gatepassSchema>;

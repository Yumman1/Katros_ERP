import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createPendingTruck,
  getLiveCounterpartiesForGatepass,
  isAllowedGatepassCommodity,
  isAllowedGatepassCounterparty,
  seedExecutionDemoIfEmpty,
} from "@/server/execution-store";
import { getMergedLocations } from "@/server/trader-master-data";

const gatepassSchema = z.object({
  movementType: z.enum(["INBOUND", "OUTBOUND"]),
  counterpartyName: z.string().trim().min(1, "Counterparty is required"),
  brokerName: z.string().trim().optional(),
  warehouseName: z.string().trim().min(1, "Warehouse is required"),
  truckNo: z.string().trim().min(1, "Truck number is required"),
  driverName: z.string().trim().optional(),
  driverPhone: z.string().trim().optional(),
  builtyDetails: z.string().trim().min(1, "Builty details are required"),
  commodityCode: z.string().trim().min(1, "Commodity is required"),
  commodityName: z.string().trim().min(1, "Commodity is required"),
  recordedByName: z.string().trim().min(1, "Your name is required"),
  weightKg: z.coerce.number().positive("Weight must be greater than 0"),
  bags: z.coerce.number().min(0).optional(),
  remarks: z.string().trim().optional(),
  gatepassNo: z.string().trim().optional(),
});

export async function GET() {
  seedExecutionDemoIfEmpty();
  const warehouseSet = new Set<string>();
  for (const loc of getMergedLocations()) warehouseSet.add(loc.name);
  return NextResponse.json({
    warehouses: Array.from(warehouseSet).sort((a, b) => a.localeCompare(b)),
    inboundCounterparties: getLiveCounterpartiesForGatepass("INBOUND"),
    outboundCounterparties: getLiveCounterpartiesForGatepass("OUTBOUND"),
  });
}

export async function POST(request: Request) {
  seedExecutionDemoIfEmpty();

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = gatepassSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid gatepass payload" },
      { status: 400 },
    );
  }

  const input = parsed.data;

  if (!isAllowedGatepassCounterparty(input.movementType, input.counterpartyName)) {
    return NextResponse.json(
      {
        error:
          input.movementType === "INBOUND"
            ? "Select a supplier from the live purchase-delivered trade list"
            : "Select a buyer from the live sale trade list",
      },
      { status: 400 },
    );
  }

  if (
    !isAllowedGatepassCommodity(
      input.movementType,
      input.counterpartyName,
      input.commodityCode,
    )
  ) {
    return NextResponse.json(
      { error: "Select a commodity from the counterparty's open trades" },
      { status: 400 },
    );
  }

  try {
    const truck = createPendingTruck({
      counterpartyName: input.counterpartyName,
      brokerName: input.brokerName || null,
      movementType: input.movementType,
      warehouseName: input.warehouseName,
      truckNo: input.truckNo,
      driverName: input.driverName || null,
      driverPhone: input.driverPhone || null,
      builtyDetails: input.builtyDetails,
      commodityCode: input.commodityCode,
      commodityName: input.commodityName,
      recordedByName: input.recordedByName,
      weightKg: input.weightKg,
      bags: input.bags ?? null,
      remarks: input.remarks || null,
      gatepassNo: input.gatepassNo || null,
    });

    return NextResponse.json({
      ok: true,
      gatepassNo: truck.gatepassNo,
      truck,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save gatepass" },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";
import { gatepassSchema } from "@/lib/gatepass-schema";
import {
  createPendingTruck,
  getLiveCounterpartiesForGatepass,
  isAllowedGatepassCommodity,
  isAllowedGatepassCounterparty,
  previewNextGatepassNo,
  updatePendingTruck,
} from "@/server/execution-store";
import { saveGatepassDocuments } from "@/server/gatepass-documents";
import { getCompanyWarehouses, getMergedLocations } from "@/server/trader-master-data";

async function parseGatepassRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const payloadRaw = formData.get("payload");
    if (typeof payloadRaw !== "string") {
      return { error: "Invalid multipart payload" as const };
    }
    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(payloadRaw);
    } catch {
      return { error: "Invalid JSON in multipart payload" as const };
    }
    const parsed = gatepassSchema.safeParse(payloadJson);
    if (!parsed.success) {
      return {
        error: parsed.error.issues[0]?.message ?? "Invalid gatepass payload",
      } as const;
    }
    const files = formData
      .getAll("documents")
      .filter((f): f is File => f instanceof File && f.size > 0);
    return { data: parsed.data, files };
  }

  const body = await request.json().catch(() => null);
  if (!body) return { error: "Invalid JSON payload" as const };
  const parsed = gatepassSchema.safeParse(body);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid gatepass payload" } as const;
  }
  return { data: parsed.data, files: [] as File[] };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const warehouse = url.searchParams.get("warehouse")?.trim() || undefined;
  const movementType = url.searchParams.get("movementType");
  const movement =
    movementType === "INBOUND" || movementType === "OUTBOUND" ? movementType : undefined;

  const companyNames = new Set((await getCompanyWarehouses()).map((w) => w.name));
  const warehouseSet = new Set<string>();
  for (const loc of await getMergedLocations()) {
    if (companyNames.has(loc.name)) warehouseSet.add(loc.name);
  }

  // Always return both lists so the form can explain when the selected movement
  // type has no trades but the opposite direction does (e.g. sale ex-warehouse → Gate Out).
  const inboundCounterparties = await getLiveCounterpartiesForGatepass("INBOUND", warehouse);
  const outboundCounterparties = await getLiveCounterpartiesForGatepass("OUTBOUND", warehouse);

  return NextResponse.json({
    warehouses: Array.from(warehouseSet).sort((a, b) => a.localeCompare(b)),
    inboundCounterparties,
    outboundCounterparties,
    nextGatepassNo: movement ? await previewNextGatepassNo(movement) : undefined,
  });
}

export async function POST(request: Request) {
  const parsed = await parseGatepassRequest(request);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const input = parsed.data;
  const weightKg = input.weightAsPerBuiltyKg;

  if (!(await isAllowedGatepassCounterparty(input.movementType, input.counterpartyName, input.warehouseName))) {
    return NextResponse.json(
      {
        error:
          input.movementType === "INBOUND"
            ? "Select a supplier with an open purchase trade at this warehouse"
            : "Select a buyer with an open sale trade at this warehouse",
      },
      { status: 400 },
    );
  }

  if (
    !(await isAllowedGatepassCommodity(
      input.movementType,
      input.counterpartyName,
      input.commodityCode,
      input.warehouseName,
    ))
  ) {
    return NextResponse.json(
      { error: "Select a commodity from the counterparty's open trades at this warehouse" },
      { status: 400 },
    );
  }

  try {
    const truck = await createPendingTruck({
      counterpartyName: input.counterpartyName,
      movementType: input.movementType,
      warehouseName: input.warehouseName,
      truckNo: input.truckNo,
      transporterName: input.transporterName || null,
      transporterPhone: input.transporterPhone || null,
      builtyDetails: input.builtyDetails,
      commodityCode: input.commodityCode,
      commodityName: input.commodityName,
      recordedByName: input.recordedByName,
      quantityAsPerBuilty: input.quantityAsPerBuilty || null,
      weightAsPerBuiltyKg: input.weightAsPerBuiltyKg,
      weighBridgeName: input.weighBridgeName || null,
      documentRefs: input.documentRefs ?? [],
      warehouseWeightKg: input.warehouseWeightKg ?? null,
      qualitySpecs: input.qualitySpecs ?? null,
      quantityBagsBales: input.quantityBagsBales ?? null,
      totalDeductionsKg: input.totalDeductionsKg ?? null,
      weightKg,
      remarks: input.remarks || null,
    });

    if (parsed.files.length) {
      const uploaded = await saveGatepassDocuments(parsed.files, truck.gatepassNo);
      await updatePendingTruck(truck.id, {
        documentRefs: [...(truck.documentRefs ?? []), ...uploaded],
      });
    }

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

const fs = require('fs');
const path = 'kastros-ctrm/server/execution-store.ts';
let content = fs.readFileSync(path, 'utf8');

const injection = `
// ─── Pending Truck Functions ───────────────────────────────────────────────────

export function createPendingTruck(input: {
  counterpartyName: string;
  brokerName?: string | null;
  movementType: "INBOUND" | "OUTBOUND";
  warehouseName: string;
  truckNo: string;
  driverName?: string | null;
  driverCnic?: string | null;
  driverPhone?: string | null;
  weightKg: number;
  bags?: number | null;
  remarks?: string | null;
  gatepassNo?: string | null;
}): PendingTruck {
  const rt = ex();
  rt.truckSeq += 1;
  const id = \`truck-\${rt.truckSeq}\`;
  const gatepassNo =
    input.gatepassNo?.trim() ||
    \`GP-\${input.movementType === "INBOUND" ? "IN" : "OUT"}-\${rt.truckSeq.toString().padStart(4, "0")}\`;
  const truck: PendingTruck = {
    id,
    gatepassNo,
    arrivalDate: new Date(),
    counterpartyName: input.counterpartyName.trim(),
    brokerName: input.brokerName?.trim() || null,
    movementType: input.movementType,
    warehouseName: input.warehouseName.trim(),
    truckNo: input.truckNo.trim().toUpperCase(),
    driverName: input.driverName || null,
    driverCnic: input.driverCnic || null,
    driverPhone: input.driverPhone || null,
    weightKg: input.weightKg,
    bags: input.bags ?? null,
    remarks: input.remarks || null,
    status: "PENDING",
    assignedTradeRef: null,
    assignedAt: null,
    remainingKg: input.weightKg,
  };
  rt.pendingTrucks.unshift(truck);
  persistExecutionState();
  return truck;
}

export function getPendingTrucks(filter?: {
  counterpartyName?: string;
  warehouseName?: string;
  movementType?: "INBOUND" | "OUTBOUND";
  status?: PendingTruckStatus;
  from?: Date;
  to?: Date;
}): PendingTruck[] {
  const rt = ex();
  let list = [...rt.pendingTrucks];
  if (filter?.counterpartyName) {
    const q = filter.counterpartyName.toLowerCase();
    list = list.filter(
      (t) =>
        t.counterpartyName.toLowerCase().includes(q) ||
        (t.brokerName?.toLowerCase().includes(q) ?? false),
    );
  }
  if (filter?.warehouseName && filter.warehouseName !== "ALL")
    list = list.filter((t) => t.warehouseName === filter.warehouseName);
  if (filter?.movementType) list = list.filter((t) => t.movementType === filter.movementType);
  if (filter?.status) list = list.filter((t) => t.status === filter.status);
  if (filter?.from) list = list.filter((t) => new Date(t.arrivalDate) >= filter.from!);
  if (filter?.to) list = list.filter((t) => new Date(t.arrivalDate) <= filter.to!);
  return list.sort(
    (a, b) => new Date(b.arrivalDate).getTime() - new Date(a.arrivalDate).getTime(),
  );
}

export function assignTruckToTrade(
  truckId: string,
  tradeRef: string,
  overrideWeightKg?: number,
): { truck: PendingTruck; receipt?: InboundReceipt; dispatch?: OutboundDispatch; splitRemainingKg: number } {
  const rt = ex();
  const truck = rt.pendingTrucks.find((t) => t.id === truckId);
  if (!truck) throw new Error("Pending truck not found");
  if (truck.status === "ASSIGNED") throw new Error("Truck already fully assigned");
  const contract = getContractByRef(tradeRef);
  if (!contract) throw new Error("Locked contract not found: " + tradeRef);
  const useKg = overrideWeightKg ?? truck.remainingKg;
  const tradeOpenKg = contract.openQtyMt * 1000;
  const allocateKg = Math.min(useKg, Math.max(tradeOpenKg, 0));
  const splitRemainingKg = Math.max(0, useKg - allocateKg);

  if (truck.movementType === "INBOUND") {
    rt.inboundSeq += 1;
    const netKg = allocateKg;
    const allocatedQtyMt = kgToMt(netKg);
    const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
    const receipt: InboundReceipt = {
      id: \`kcs-\${rt.inboundSeq}\`,
      gatepassNo: truck.gatepassNo,
      kcsNo: \`KCS-\${rt.inboundSeq}\`,
      receiveDate: truck.arrivalDate,
      truckNo: truck.truckNo,
      driverName: truck.driverName,
      driverCnic: truck.driverCnic,
      driverPhone: truck.driverPhone,
      biltyNo: "-",
      trnNo: "-",
      warehouseName: truck.warehouseName,
      sellerName: truck.brokerName || truck.counterpartyName,
      tradeRef,
      billNo: null,
      bags: truck.bags ?? null,
      weightSpotKg: allocateKg,
      weightWarehouseKg: allocateKg,
      weightDiffKg: 0,
      qualityReadings: contract.qualityTolerances,
      deductionPct: 0,
      allocatedQtyMt,
      fifoOverrideReason: null,
      amountDue: netKg * rateKg,
      status: "ALLOCATED",
      paymentRequestId: null,
      documentRefs: [truck.gatepassNo],
      remarks: truck.remarks,
    };
    rt.inboundReceipts.unshift(receipt);
    refreshContract(tradeRef);
    truck.remainingKg = splitRemainingKg;
    truck.status = splitRemainingKg > 0.5 ? "PARTIAL" : "ASSIGNED";
    truck.assignedTradeRef = tradeRef;
    truck.assignedAt = new Date();
    persistExecutionState();
    return { truck, receipt, splitRemainingKg };
  } else {
    rt.outboundSeq += 1;
    const allocatedQtyMt = kgToMt(allocateKg);
    const rateKg = contract.ratePerKg ?? (contract.ratePerMaund ?? 0) / KG_PER_MAUND;
    const dispatch: OutboundDispatch = {
      id: \`out-\${rt.outboundSeq}\`,
      gatepassNo: truck.gatepassNo,
      dispatchDate: truck.arrivalDate,
      liftedBy: truck.driverName || truck.counterpartyName,
      buyerName: truck.brokerName || truck.counterpartyName,
      tradeRef,
      warehouseName: truck.warehouseName,
      truckNo: truck.truckNo,
      driverName: truck.driverName,
      driverCnic: truck.driverCnic,
      driverPhone: truck.driverPhone,
      dispatchWeightKg: allocateKg,
      invoiceWeightKg: allocateKg,
      fungusPct: 0,
      doRef: truck.gatepassNo,
      fifoOverrideReason: null,
      allocatedQtyMt,
      amountDue: allocateKg * rateKg,
      status: "WEIGHED",
      paymentRequestId: null,
      documentRefs: [truck.gatepassNo],
      remarks: truck.remarks,
    };
    rt.outboundDispatches.unshift(dispatch);
    refreshContract(tradeRef);
    truck.remainingKg = splitRemainingKg;
    truck.status = splitRemainingKg > 0.5 ? "PARTIAL" : "ASSIGNED";
    truck.assignedTradeRef = tradeRef;
    truck.assignedAt = new Date();
    persistExecutionState();
    return { truck, dispatch, splitRemainingKg };
  }
}

// ─── Movements CSV Export ──────────────────────────────────────────────────────

export function exportMovementsCsv(filter?: {
  warehouseName?: string;
  commodityCode?: string;
  movementType?: "INBOUND" | "OUTBOUND" | "ALL";
  from?: Date;
  to?: Date;
}): string {
  const rt = ex();
  const contractByRef = new Map(rt.contracts.entries());
  const escape = (v: string | number) => \`"\${String(v).replace(/"/g, '""')}"\`;
  const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-PK");
  const rows: string[] = [
    "Type,Gatepass No,Date,Truck No,Warehouse,Trade Ref,Commodity,Counterparty,Gross Wt (kg),Net Qty (MT),Status,Driver,Remarks",
  ];
  const wh = filter?.warehouseName && filter.warehouseName !== "ALL" ? filter.warehouseName : null;
  const cm = filter?.commodityCode && filter.commodityCode !== "ALL" ? filter.commodityCode : null;
  const tp = filter?.movementType && filter.movementType !== "ALL" ? filter.movementType : null;
  const from = filter?.from;
  const to = filter?.to;
  if (!tp || tp === "INBOUND") {
    for (const r of rt.inboundReceipts) {
      const d = new Date(r.receiveDate);
      if (from && d < from) continue;
      if (to && d > to) continue;
      if (wh && r.warehouseName !== wh) continue;
      const c = contractByRef.get(r.tradeRef);
      if (cm && c?.commodityCode !== cm) continue;
      rows.push(
        ["INBOUND", r.gatepassNo ?? r.kcsNo, fmtDate(d), r.truckNo, r.warehouseName, r.tradeRef,
          c?.commodityCode ?? "-", r.sellerName, r.weightWarehouseKg, r.allocatedQtyMt.toFixed(3),
          r.status, r.driverName ?? "", r.remarks ?? ""].map(escape).join(","),
      );
    }
  }
  if (!tp || tp === "OUTBOUND") {
    for (const d2 of rt.outboundDispatches) {
      const d = new Date(d2.dispatchDate);
      if (from && d < from) continue;
      if (to && d > to) continue;
      if (wh && d2.warehouseName !== wh) continue;
      const c = contractByRef.get(d2.tradeRef);
      if (cm && c?.commodityCode !== cm) continue;
      rows.push(
        ["OUTBOUND", d2.gatepassNo ?? d2.doRef ?? d2.id, fmtDate(d), d2.truckNo, d2.warehouseName, d2.tradeRef,
          c?.commodityCode ?? "-", d2.buyerName, d2.dispatchWeightKg, d2.allocatedQtyMt.toFixed(3),
          d2.status, d2.driverName ?? "", d2.remarks ?? ""].map(escape).join(","),
      );
    }
  }
  return rows.join("\\n");
}

`;

const marker = '/** Seed demo data if the execution store is empty. Called once per server boot in mock mode. */';
if (!content.includes(marker)) {
  console.error('Marker not found!');
  process.exit(1);
}
content = content.replace(marker, injection + marker);
fs.writeFileSync(path, content, 'utf8');
console.log('Injection complete. File size:', content.length);

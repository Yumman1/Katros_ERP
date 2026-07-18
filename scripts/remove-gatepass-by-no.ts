/**
 * Remove a gatepass and revert linked trade fulfillment + inventory.
 * Usage: npx tsx scripts/remove-gatepass-by-no.ts GP-OUT-0008
 */
import {
  deleteOutboundDispatch,
  deletePendingTruck,
  getContractByRef,
  getWarehouseCommodityStockMt,
  syncExecutionFromDisk,
} from "../server/execution-store";

const gatepassNo = process.argv[2]?.trim();
if (!gatepassNo) {
  console.error("Usage: npx tsx scripts/remove-gatepass-by-no.ts <gatepassNo>");
  process.exit(1);
}

process.env.LOCAL_PERSIST = "true";

syncExecutionFromDisk();

const g = globalThis as typeof globalThis & {
  __kastrosExecutionRuntime?: {
    pendingTrucks: {
      id: string;
      gatepassNo: string;
      assignedTradeRef?: string | null;
      warehouseName?: string | null;
    }[];
    outboundDispatches: { id: string; gatepassNo?: string | null; tradeRef: string; warehouseName: string }[];
  };
};

const rt = g.__kastrosExecutionRuntime;
if (!rt) throw new Error("Execution runtime not loaded");

const dispatch = rt.outboundDispatches.find((d) => d.gatepassNo === gatepassNo);
const truck = rt.pendingTrucks.find((t) => t.gatepassNo === gatepassNo);

console.log("Found:", {
  dispatch: dispatch ? { id: dispatch.id, tradeRef: dispatch.tradeRef } : null,
  truck: truck ? { id: truck.id, tradeRef: truck.assignedTradeRef } : null,
});

const tradeRef = dispatch?.tradeRef ?? truck?.assignedTradeRef ?? null;
const before = tradeRef ? getContractByRef(tradeRef) : null;
if (before) {
  console.log("Trade before:", {
    tradeRef,
    receivedQtyMt: before.receivedQtyMt,
    openQtyMt: before.openQtyMt,
    contractStatus: before.contractStatus,
  });
}

if (dispatch) {
  deleteOutboundDispatch(dispatch.id);
  console.log("Deleted outbound dispatch:", dispatch.id);
}

if (truck) {
  deletePendingTruck(truck.id);
  console.log("Deleted pending truck:", truck.id);
}

if (!dispatch && !truck) {
  console.error("Gatepass not found:", gatepassNo);
  process.exit(1);
}

const after = tradeRef ? getContractByRef(tradeRef) : null;
if (after) {
  console.log("Trade after:", {
    tradeRef,
    receivedQtyMt: after.receivedQtyMt,
    openQtyMt: after.openQtyMt,
    contractStatus: after.contractStatus,
  });
  const wh = dispatch?.warehouseName ?? truck?.warehouseName;
  const commodity = before?.commodityCode;
  if (wh && commodity) {
    console.log("Warehouse stock after:", {
      warehouse: wh,
      commodity,
      netMt: getWarehouseCommodityStockMt(wh, commodity),
    });
  }
}

console.log("Done. Restart dev server if it was running to reload in-memory state.");

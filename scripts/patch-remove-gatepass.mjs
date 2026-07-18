/**
 * Direct patch execution-state.json (use when dev server may overwrite in-memory state).
 * Usage: npx tsx scripts/patch-remove-gatepass.mjs GP-OUT-0008
 */
import fs from "fs";
import path from "path";
import superjson from "superjson";

const gatepassNo = process.argv[2]?.trim();
if (!gatepassNo) {
  console.error("Usage: npx tsx scripts/patch-remove-gatepass.mjs <gatepassNo>");
  process.exit(1);
}

const file = path.join(process.cwd(), "data", "local", "execution-state.json");
const snap = superjson.parse(fs.readFileSync(file, "utf8"));

const outboundBefore = snap.outboundDispatches.length;
const trucksBefore = snap.pendingTrucks.length;

snap.outboundDispatches = snap.outboundDispatches.filter((d) => d.gatepassNo !== gatepassNo);
snap.pendingTrucks = snap.pendingTrucks.filter((t) => t.gatepassNo !== gatepassNo);

const removedOutbound = outboundBefore - snap.outboundDispatches.length;
const removedTrucks = trucksBefore - snap.pendingTrucks.length;

const tradeRefs = new Set();
for (const d of snap.outboundDispatches) tradeRefs.add(d.tradeRef);
for (const r of snap.inboundReceipts) tradeRefs.add(r.tradeRef);

function fulfilledQty(tradeRef, direction) {
  if (direction === "SELL") {
    return snap.outboundDispatches
      .filter((d) => d.tradeRef === tradeRef && d.status !== "AT_GATE")
      .reduce((s, d) => s + d.allocatedQtyMt, 0);
  }
  return snap.inboundReceipts
    .filter((r) => r.tradeRef === tradeRef && r.status !== "DRAFT")
    .reduce((s, r) => s + r.allocatedQtyMt, 0);
}

for (const [ref, contract] of snap.contracts) {
  const fulfilled = fulfilledQty(ref, contract.direction);
  contract.receivedQtyMt = fulfilled;
  contract.openQtyMt = Math.max(0, contract.contractualQtyMt - fulfilled);
  contract.contractStatus = contract.openQtyMt > 0.001 ? "Open" : "Close";
  if (ref === "KAS-2026-10024" || removedOutbound || removedTrucks) {
    console.log("Contract updated:", ref, {
      receivedQtyMt: contract.receivedQtyMt,
      openQtyMt: contract.openQtyMt,
      contractStatus: contract.contractStatus,
    });
  }
}

const tmp = `${file}.${process.pid}.tmp`;
fs.writeFileSync(tmp, superjson.stringify(snap), "utf8");
fs.renameSync(tmp, file);

console.log(`Removed ${removedOutbound} outbound, ${removedTrucks} pending truck(s) for ${gatepassNo}`);
console.log("Saved. Restart `npm run dev` so the server reloads from disk.");

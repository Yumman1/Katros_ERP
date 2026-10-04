import assert from "node:assert/strict";
import { test } from "node:test";
import { processingYield, PROCESSING_ROUTES } from "./sesame-processing";
import { leaseReminder } from "./warehouse-lease";
import { stockTransferDelta } from "./inventory-stock";
for (const route of PROCESSING_ROUTES) test(`${route.from} → ${route.to}: 100 kg at 98% conserves physical stock`,()=>{
 assert.deepEqual(processingYield(100,0.98),{inputKg:100,outputKg:98,impuritiesKg:2});
});
test("rounding and endpoint yields conserve kilograms",()=>{
 for (const yieldRatio of [0,0.000001,0.333333,0.98,1]) {
  const r=processingYield(123.456,yieldRatio);
  assert.equal(Math.round((r.outputKg+r.impuritiesKg)*1000),123456);
 }
 assert.equal(processingYield(100,0).impuritiesKg,100);
 assert.equal(processingYield(100,1).impuritiesKg,0);
 for (const [input,yieldRatio] of [[0,0.98],[-1,0.98],[100,-1],[100,98],[Infinity,0.98],[100,NaN]]) assert.throws(()=>processingYield(input,yieldRatio));
});
test("internal truck changes each warehouse only at its own gate",()=>{
 const t={commodityCode:"SES",fromWarehouseName:"Source",toWarehouseName:"Processor",dispatchedQtyMt:0.1,receivedQtyMt:0.099,status:"DRAFT"};
 assert.equal(stockTransferDelta("Source",t),0);
 t.status="IN_TRANSIT";assert.equal(stockTransferDelta("Source",t),-0.1);assert.equal(stockTransferDelta("Processor",t),0);
 t.status="RECEIVED";assert.equal(stockTransferDelta("Source",t),-0.1);assert.equal(stockTransferDelta("Processor",t),0.099);
});
test("lease reminder begins exactly halfway and recalculates edited periods",()=>{
 const start="2026-01-01T00:00:00Z";
 assert.equal(leaseReminder(start,6,new Date("2026-03-01")),null);
 const due=leaseReminder(start,6,new Date("2026-05-01"));assert.ok(due);assert.equal(due.end.toISOString(),"2026-07-01T00:00:00.000Z");
 assert.equal(leaseReminder(start,12,new Date("2026-05-01")),null);
 assert.ok(leaseReminder(start,6,due.halfway));
 assert.equal(leaseReminder(start,6,new Date(due.halfway.getTime()-1)),null);
 assert.equal(leaseReminder(null,6),null);
 assert.equal(leaseReminder("bad",6),null);
 assert.equal(leaseReminder("2026-01-31",1,new Date("2026-03-01"))?.end.toISOString(),"2026-02-28T00:00:00.000Z");
});

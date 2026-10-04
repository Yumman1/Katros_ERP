/** Run only against an isolated local database with TEST_SESAME_PROCESSING=1. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { createStockTransfer, dispatchStockTransfer, receiveStockTransfer, cancelStockTransfer } from "@/server/execution/stock-transfers";
import { recordProcessing, sesameGrades, assertGradeAvailable } from "@/server/execution/sesame-processing";
import { physicalStock } from "@/server/execution/sesame-stock";
import { computePositionLedger } from "@/server/position-ledger";
import { getSeasonNetPositions } from "@/server/net-position";
import { PROCESSING_ROUTES } from "@/lib/sesame-processing";
async function main() {
  const url = new URL(process.env.POSTGRES_PRISMA_URL ?? "http://missing");
  assert.ok(process.env.TEST_SESAME_PROCESSING === "1" && ["localhost","127.0.0.1"].includes(url.hostname),"Use an isolated local test database");
  assert.equal(await prisma.user.count(),0,"Test fixture expects an empty database");
  const user=await prisma.user.create({data:{email:"processing-test@example.invalid",name:"Processing Test",passwordHash:"not-a-login",role:"ADMIN"}});
  for (const [index,route] of PROCESSING_ROUTES.entries()) {
    const source=`Processing Test Source ${index}`, target=`Processing Test Target ${index}`;
    for (const name of [source,target]) await prisma.location.create({data:{name,type:"WAREHOUSE",country:"Pakistan",warehouseBasis:"USE",createdById:user.id}});
    await prisma.stockTransfer.create({data:{transferRef:`TEST-OPEN-${index}`,commodityCode:"SES",commodityName:"Sesame",sesameType:route.from,externalOrigin:"Test opening balance",toWarehouseName:source,dispatchedQtyMt:1,receivedQtyMt:1,truckNo:"OPENING",status:"RECEIVED"}});
    const shift=await createStockTransfer({commodityCode:"SES",commodityName:"Sesame",fromWarehouseName:source,toWarehouseName:target,dispatchedQtyMt:0.1,truckNo:`TEST-${index}`,sesameType:route.from,purpose:"PROCESSING",createdByName:"Test"});
    const input={code:"SES",transferId:shift.id,toType:route.to,inputKg:100,yieldRatio:0.98,requestKey:randomUUID(),actor:"Test"};
    await assert.rejects(recordProcessing(input),/Receive the internal/);
    await dispatchStockTransfer(shift.id,"Gate out test");
    await assert.rejects(dispatchStockTransfer(shift.id,"Duplicate"),/Only a draft/);
    await assert.rejects(cancelStockTransfer(shift.id,"Cannot reverse goods on road"),/already been received|shift the stock back/);
    assert.equal((await physicalStock(prisma,"SES")).get(source),0.9);
    assert.equal((await physicalStock(prisma,"SES")).get(target)??0,0);
    await receiveStockTransfer(shift.id,"Gate in test",0.1);
    await assert.rejects(receiveStockTransfer(shift.id,"Duplicate",0.1),/Only a transfer in transit/);
    const saved=await recordProcessing(input);
    assert.deepEqual(await recordProcessing(input),saved,"Retry must not consume stock twice");
    await assert.rejects(recordProcessing({...input,requestKey:randomUUID(),inputKg:1}),/unprocessed quantity/);
    const warehouse=(await sesameGrades(prisma,"SES")).find(r=>r.name===target)!;
    assert.equal(warehouse.grades[route.from],0);
    assert.equal(warehouse.grades[route.to],0.098);
    assert.equal(warehouse.grades.Impurities,0.002);
    assert.equal(warehouse.sesameStockMt,0.1);
    assert.equal((await physicalStock(prisma,"SES")).get(target),0.1);
    await assert.rejects(assertGradeAvailable(prisma,"SES",target,route.from,0.001),/Insufficient/);
    const returning=await createStockTransfer({commodityCode:"SES",commodityName:"Sesame",fromWarehouseName:target,toWarehouseName:source,dispatchedQtyMt:0.098,truckNo:"RETURN",sesameType:route.to});
    await dispatchStockTransfer(returning.id,"Return gate out");
    await receiveStockTransfer(returning.id,"Return gate in",0.098);
    const after=(await sesameGrades(prisma,"SES")).find(r=>r.name===target)!;
    assert.equal(after.grades[route.to],0);assert.equal(after.grades.Impurities,0.002);
    console.log(`PASS: ${route.from} → ${route.to}, gates, conversion, retry, over-processing and return`);
  }
  const position=(await getSeasonNetPositions()).find(r=>r.commodityCode==="SES");
  assert.equal(position?.inventoryMt,2.99); // 3 MT opening - 0.006 MT impurities, rounded to 2 decimals
  assert.ok(Math.abs((await computePositionLedger()).find(r=>r.commodityCode==="SES")!.physicalNet-2.994)<0.000001,"Trader and execution position ledger excludes processing impurities");
  assert.equal(await prisma.pendingTruck.count(),0,"Internal operations must not create external trucks");
  assert.equal(await prisma.inboundReceipt.count(),0);assert.equal(await prisma.outboundDispatch.count(),0);
  console.log("PASS: positions exclude impurities; internal flows create no external movements");
}
main().finally(()=>prisma.$disconnect());

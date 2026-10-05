/** Run against an empty, disposable local database only. */
import assert from "node:assert/strict";
import { prisma } from "@/server/db";
import { GET, POST } from "@/app/api/internal-gate/route";
import { createInternalGateAccess, readInternalGateAccess } from "@/server/execution/internal-gate-access";
import { createStockTransfer } from "@/server/execution/stock-transfers";

async function main() {
  const url = new URL(process.env.POSTGRES_PRISMA_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "55433");
  assert.equal(await prisma.user.count(), 0);
  process.env.NEXTAUTH_SECRET = "isolated-internal-gate-integration-test-secret";
  const user = await prisma.user.create({data:{email:"gate@example.invalid",name:"Gate Test",passwordHash:"not-a-login",role:"ADMIN"}});
  await prisma.location.create({data:{name:"Gate Destination",type:"WAREHOUSE",country:"Pakistan",warehouseBasis:"USE",createdById:user.id}});
  for (const code of ["CORN", "SES"]) {
    await createStockTransfer({commodityCode:code,commodityName:code==="SES"?"Sesame":"Corn",externalOrigin:"Owned outside yard",toWarehouseName:"Gate Destination",dispatchedQtyMt:1,truckNo:`TEST-${code}`,season:code==="CORN"?"WINTER":undefined,sesameType:"Raw"});
  }
  assert.equal((await GET(new Request("http://localhost/api/internal-gate"))).status,400);
  for (const code of ["CORN", "SES"]) {
    const access=createInternalGateAccess(code);
    assert.equal(readInternalGateAccess(access),code);
    assert.equal(readInternalGateAccess(access.slice(0,-1)+(access.endsWith("a")?"b":"a")),null);
    assert.equal((await GET(new Request(`http://localhost/api/internal-gate?access=${access}invalid`))).status,403);
    const read = await GET(new Request(`http://localhost/api/internal-gate?access=${access}`));
    assert.equal(read.status,200);
    const {movements}=await read.json();
    assert.equal(movements.length,1);assert.equal(movements[0].commodityCode,code);
    const token=movements[0].internalGateToken;
    const submit = (direction:string,receivedKg?:number)=>POST(new Request("http://localhost/api/internal-gate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,direction,recordedBy:"Warehouse Staff",receivedKg})}));
    assert.equal((await submit("in",980)).status,400,"Cannot receive before dispatch");
    assert.equal((await submit("out")).status,200);
    assert.equal((await submit("out")).status,400,"Cannot dispatch twice");
    assert.equal((await submit("in")).status,400,"Received weight required");
    assert.equal((await submit("in",980)).status,200);
    assert.equal((await submit("in",980)).status,400,"Cannot receive twice");
    const saved=await prisma.stockTransfer.findUniqueOrThrow({where:{internalGateToken:token}});
    assert.equal(saved.dispatchedBy,"Warehouse Staff");assert.equal(saved.receivedBy,"Warehouse Staff");
    assert.equal(Number(saved.receivedQtyMt),.98);
    if(code==="CORN")assert.equal(saved.season,"WINTER");
    const after=await GET(new Request(`http://localhost/api/internal-gate?access=${access}`));
    assert.equal((await after.json()).movements.length,0,"Completed shifts leave the pending selection");
    assert.equal((await GET(new Request(`http://localhost/api/internal-gate?token=${token}`))).status,200,"Existing truck-specific links still work");
    console.log(`PASS: ${code} scoped link, gate out/in, weights, audit, repeat protection and existing links`);
  }
  assert.equal(await prisma.pendingTruck.count(),0);
  assert.equal(await prisma.inboundReceipt.count(),0);
  assert.equal(await prisma.outboundDispatch.count(),0);
}
main().finally(()=>prisma.$disconnect());

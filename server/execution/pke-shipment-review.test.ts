import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import type {User} from '@prisma/client';
import {prisma} from '@/server/db';
import {reviewShipment} from './pke-shipment-review';
import type {PkeImportPayload} from '@/lib/pke-import';
test('claim needs owning trader approval and cannot post a duplicate debit',async()=>{
 const payload:PkeImportPayload={references:{'BL quantity MT':'200','Vessel received MT':'195','Vessel arrival date':'2026-11-06','Bill of lading':'BL1'},documents:[],history:[]};
 const file={id:'file',purchaseTradeRef:'BUY',payload};
 const trade={tradeRef:'BUY',traderName:'Sami',direction:'BUY',tradeStatus:'LOCKED',quantity:200,tradeParams:{tradingEntity:'Kastros FZCO'},commodity:{code:'PKE'},contract:{ratePerKg:10,quantityToleranceMt:2}};
 const debits:unknown[]=[];
 const db={$queryRaw:async()=>[],pkeImportFile:{findUniqueOrThrow:async()=>file,findMany:async()=>[file],update:async({data}:{data:{payload:PkeImportPayload}})=>Object.assign(file,data)},trade:{findUniqueOrThrow:async()=>trade,update:async()=>{}},counterparty:{findFirst:async()=>({id:'insurer',name:'tes insurance'})},counterpartyLedgerEntry:{create:async(v:unknown)=>debits.push(v),aggregate:async()=>({_sum:{amountPkr:0}})},voucher:{aggregate:async()=>({_sum:{amountPkr:0}})},executionContract:{update:async()=>{}}};
 const execution={id:'exec',role:'EXECUTION',name:'Execution',email:'exec@example.com'} as User;
 const trader={id:'trader',role:'TRADER',name:'Sami',email:'sami@example.com'} as User;
 const m=mock.method(prisma,'$transaction',async(fn:(db:unknown)=>Promise<unknown>)=>fn(db));
 try{await reviewShipment({id:'file',action:'INSURANCE',insurerId:'insurer',reason:'Shortage'},execution);assert.equal(debits.length,0);const req=file.payload.shipmentReviews![0];assert.equal(req.amountPkr,50000);
 await assert.rejects(reviewShipment({id:'file',action:'APPROVED',reviewId:req.id,reason:'Review'},execution),/assigned trader/);
 await assert.rejects(reviewShipment({id:'file',action:'APPROVED',reviewId:req.id,reason:'Review'},{...trader,name:'Other'}),/assigned trader/);
 await reviewShipment({id:'file',action:'APPROVED',reviewId:req.id,reason:'Review'},trader);assert.equal(debits.length,1);
 await assert.rejects(reviewShipment({id:'file',action:'APPROVED',reviewId:req.id,reason:'Again'},trader),/already resolved/);
 }finally{m.mock.restore();}
});

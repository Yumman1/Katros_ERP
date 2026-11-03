import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Prisma} from '@prisma/client';
import {pkePaymentOptions,reservePkePayment,validatePkePaymentApproval} from './pke-import-payments';
function fixture(internal=false){
 const trade={commodity:{code:'PKE'},direction:'BUY',currency:'USD',tradeParams:internal?{tradingEntity:'Kastros PAK',internalCounterpartyEntity:'FZCO'}:{tradingEntity:'Kastros FZCO'}};
 const side=internal?'PAK_DUBAI':'DUBAI_SUPPLIER';
 const payload={references:{'Bill of lading':'BL-1','Supplier BL invoice amount':'1000','Dubai BL invoice amount':'1200'},lcs:[{id:'lc1',reference:'LC1',side,currency:'USD',amount:'800'}]};
 const payments:{id:string;status:string;pkePayment:Record<string,unknown>}[]=[];
 const db={ $queryRaw:async()=>[],trade:{findUnique:async()=>trade},pkeImportFile:{findMany:async()=>[{id:'file',title:'Shipment',payload}]},voucher:{findMany:async({where}:{where:{id?:{not:string}}})=>payments.filter(v=>v.status!=='REJECTED'&&v.id!==where.id?.not)}} as unknown as Prisma.TransactionClient;
 const add=(amount:number,status='PENDING_FINANCE',id='v1')=>payments.push({id,status,pkePayment:{fileId:'file',bl:true,blNo:'BL-1',lcId:'lc1',lcReference:'LC1',currency:'USD',amount,side}});
 return {db,trade,payload,payments,add};
}
test('supplier reservation uses frozen trade FX and separate BL / LC limits',async()=>{
 const f=fixture();f.add(300);const [option]=await pkePaymentOptions('BUY',f.db);
 assert.equal(option.blAvailable,700);assert.equal(option.lcs[0].available,500);
 const payment=await reservePkePayment(f.db,'BUY',{fileId:'file',bl:true,lcId:'lc1'},140000,280);
 assert.equal(payment?.amount,500);
 await assert.rejects(reservePkePayment(f.db,'BUY',{fileId:'file',bl:true,lcId:'lc1'},140002.8,280),/LC limit/);
 await assert.rejects(reservePkePayment(f.db,'BUY',{fileId:'file',bl:true},196002.8,280),/BL balance/);
});
test('approved and pending consume limits, rejected reservations are released',async()=>{
 const f=fixture();f.add(300,'APPROVED');f.add(200,'PENDING_FINANCE','v2');f.add(200,'REJECTED','v3');
 const [option]=await pkePaymentOptions('BUY',f.db);assert.equal(option.lcs[0].paid,300);assert.equal(option.lcs[0].used,500);assert.equal(option.lcs[0].available,300);
});
test('shared internal voucher selects Pakistan-to-Dubai LC and its own invoice value',async()=>{
 const f=fixture(true);const [option]=await pkePaymentOptions('SALE',f.db);assert.equal(option.side,'PAK_DUBAI');assert.equal(option.blAmount,1200);assert.equal(option.lcs.length,1);
});
test('wrong file, LC side, missing BL amount and unsupported currency are rejected',async()=>{
 const f=fixture();await assert.rejects(reservePkePayment(f.db,'BUY',{fileId:'other',bl:true},280,280),/does not belong/);
 f.payload.references['Supplier BL invoice amount']='';await assert.rejects(reservePkePayment(f.db,'BUY',{fileId:'file',bl:true},280,280),/invoice amount/);
 f.payload.lcs[0].side='PAK_DUBAI';await assert.rejects(reservePkePayment(f.db,'BUY',{fileId:'file',bl:false,lcId:'lc1'},280,280),/correct payment side/);
 f.payload.lcs[0].side='DUBAI_SUPPLIER';f.payload.lcs[0].currency='AED';await assert.rejects(reservePkePayment(f.db,'BUY',{fileId:'file',bl:false,lcId:'lc1'},280,280),/currency/);
});
test('finance excludes current reservation, but detects changed references',async()=>{
 const f=fixture();f.add(800);const voucher={id:'v1',tradeRef:'BUY',pkePayment:f.payments[0].pkePayment as Prisma.JsonObject,amountPkr:224000,paymentFxRate:280};
 await validatePkePaymentApproval(f.db,voucher);f.payload.references['Bill of lading']='CHANGED';await assert.rejects(validatePkePaymentApproval(f.db,voucher),/changed/);
});
test('non PKE workflows have no import payment options',async()=>{
 const f=fixture();f.trade.commodity.code='SESAME';assert.deepEqual(await pkePaymentOptions('S',f.db),[]);
});

import {internationalPurchaseTrades} from './international-purchase';
test('fully received PKE purchase stays payable until Finance pays, pending reserves balance',async()=>{
 const queries:unknown[]=[];
 const trade={tradeRef:'BUY',tradeStatus:'EXECUTED',commodity:{code:'PKE'},direction:'BUY',tradeScope:'INTERNATIONAL',tradeParams:{tradingEntity:'Kastros FZCO',executionFxPkrPerUsd:280},quantity:1,currency:'USD',contract:{contractStatus:'Close',ratePerKg:280,openQtyMt:0},counterpartyId:'supplier',counterparty:{name:'Supplier'}};
 const payments=[{tradeRef:'BUY',amountPkr:140000,status:'APPROVED'},{tradeRef:'BUY',amountPkr:140000,status:'PENDING_FINANCE'}];
 const db={counterparty:{findUniqueOrThrow:async()=>({})},trade:{findMany:async(q:unknown)=>{queries.push(q);return [trade];}},voucher:{findMany:async()=>payments}} as unknown as Prisma.TransactionClient;
 let rows=await internationalPurchaseTrades('PKE','FZCO','supplier',db);
 assert.equal(rows.length,1);assert.equal(rows[0].openMt,0);assert.equal(rows[0].availablePkr,0);assert.equal(rows[0].outstandingPkr,140000);
 assert.deepEqual((queries[0] as {where:{contract:unknown}}).where.contract,{isNot:null});
 payments[1].status='APPROVED';rows=await internationalPurchaseTrades('PKE','FZCO','supplier',db);assert.equal(rows.length,0);
 await internationalPurchaseTrades('SESAME','FZCO','supplier',db);
 assert.deepEqual((queries[2] as {where:{contract:unknown}}).where.contract,{is:{contractStatus:'Open'}});
});

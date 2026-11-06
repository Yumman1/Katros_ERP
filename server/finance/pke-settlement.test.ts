import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Prisma} from '@prisma/client';
import {settlePkeTrade} from './pke-settlement';
test('received goods do not close Dubai; full approved payment does',async()=>{
 let paid=0;const updates:{contractStatus:string}[]=[];
 const t={tradeRef:'BUY',direction:'BUY',commodity:{code:'PKE'},tradeParams:{tradingEntity:'Kastros FZCO'},quantity:200,contract:{ratePerKg:100,receivedQtyMt:200}};
 const db={pkeImportFile:{findMany:async()=>[{payload:{references:{'BL quantity MT':'200','Vessel arrival date':'2026-11-06','Vessel received MT':'195'}}}]},trade:{findUniqueOrThrow:async()=>t,update:async()=>{}},counterpartyLedgerEntry:{aggregate:async()=>({_sum:{amountPkr:0}})},voucher:{aggregate:async()=>({_sum:{amountPkr:paid}})},executionContract:{update:async({data}:{data:{contractStatus:string}})=>updates.push(data)}} as unknown as Prisma.TransactionClient;
 assert.equal(await settlePkeTrade(db,'BUY'),false);assert.equal(updates.at(-1)?.contractStatus,'Open');
 paid=19999999;assert.equal(await settlePkeTrade(db,'BUY'),false);
 paid=20000000;assert.equal(await settlePkeTrade(db,'BUY'),true);assert.equal(updates.at(-1)?.contractStatus,'Close');
});
test('Pakistan port sale stays open after full dispatch and partial payment, closes only after full invoiced payment',async()=>{
 let paid=50000;const updates:{contractStatus:string}[]=[];
 const t={tradeRef:'PORT',direction:'SELL',commodity:{code:'PKE'},tradeParams:{tradingEntity:'Kastros Pakistan',pkePortFileId:'vessel'},quantity:50,contract:{ratePerKg:1.199,receivedQtyMt:50}};
 const db={pkeImportFile:{findMany:async()=>[{payload:{references:{'BL quantity MT':'200','Vessel arrival date':'2026-11-06','Vessel received MT':'195'}}}]},trade:{findUniqueOrThrow:async()=>t,update:async()=>{}},counterpartyLedgerEntry:{aggregate:async()=>({_sum:{amountPkr:60009.95}})},voucher:{aggregate:async()=>({_sum:{amountPkr:paid}})},executionContract:{update:async({data}:{data:{contractStatus:string}})=>updates.push(data)}} as unknown as Prisma.TransactionClient;
 assert.equal(await settlePkeTrade(db,'PORT'),false);assert.equal(updates.at(-1)?.contractStatus,'Open');
 paid=59950;assert.equal(await settlePkeTrade(db,'PORT'),false);
 paid=60009.95;assert.equal(await settlePkeTrade(db,'PORT'),true);
});

test('full payment without vessel arrival must remain open',async()=>{
 const t={tradeRef:'BUY',direction:'BUY',commodity:{code:'PKE'},tradeStatus:'LOCKED',tradeParams:{tradingEntity:'Kastros FZCO'},quantity:200,contract:{ratePerKg:100}};
 const db={trade:{findUniqueOrThrow:async()=>t,update:async()=>{}},pkeImportFile:{findMany:async()=>[{payload:{references:{'BL quantity MT':'200'}}}]},counterpartyLedgerEntry:{aggregate:async()=>({_sum:{amountPkr:0}})},voucher:{aggregate:async()=>({_sum:{amountPkr:20000000}})},executionContract:{update:async()=>{}}} as unknown as Prisma.TransactionClient;
 assert.equal(await settlePkeTrade(db,'BUY'),false);
});

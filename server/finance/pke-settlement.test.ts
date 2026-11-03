import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Prisma} from '@prisma/client';
import {settlePkeTrade} from './pke-settlement';
test('received goods do not close Dubai; full approved payment does',async()=>{
 let paid=0;const updates:{contractStatus:string}[]=[];
 const t={tradeRef:'BUY',direction:'BUY',commodity:{code:'PKE'},tradeParams:{tradingEntity:'Kastros FZCO'},quantity:200,contract:{ratePerKg:100,receivedQtyMt:200}};
 const db={trade:{findUniqueOrThrow:async()=>t,update:async()=>{}},voucher:{aggregate:async()=>({_sum:{amountPkr:paid}})},executionContract:{update:async({data}:{data:{contractStatus:string}})=>updates.push(data)}} as unknown as Prisma.TransactionClient;
 assert.equal(await settlePkeTrade(db,'BUY'),false);assert.equal(updates.at(-1)?.contractStatus,'Open');
 paid=19999999;assert.equal(await settlePkeTrade(db,'BUY'),false);
 paid=20000000;assert.equal(await settlePkeTrade(db,'BUY'),true);assert.equal(updates.at(-1)?.contractStatus,'Close');
});

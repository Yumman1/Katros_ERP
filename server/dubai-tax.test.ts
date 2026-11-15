import test from 'node:test';
import assert from 'node:assert/strict';
import {Prisma} from '@prisma/client';
import {settlementTargetPkr} from './settlement-billing';
test('Dubai sale settlement excludes 236G for both filer statuses',async()=>{
 for(const status of ['FILER','NON_FILER'] as const){
 const result=await settlementTargetPkr({direction:'SELL',quantity:new Prisma.Decimal(100),price:new Prisma.Decimal(400),pricePerCanonicalQty:new Prisma.Decimal(400),counterparty:{taxFilerStatus:status},tradeParams:{tradingEntity:'Kastros FZCO'}});
 assert.deepEqual(result,{notionalPkr:40000,taxRatePct:0,advanceTaxPkr:0,targetPkr:40000});
 }
});

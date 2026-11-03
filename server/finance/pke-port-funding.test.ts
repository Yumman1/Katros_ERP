import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Prisma} from '@prisma/client';
import {canFundTruck} from './ledger';
test('a port DO cannot use unrelated buyer credit or partial payment to bypass full trade receipt',async()=>{
 const db={trade:{findUnique:async()=>({quantity:50,contract:{ratePerKg:1.199},paymentType:'ADVANCE',tradeParams:{pkePortFileId:'vessel'},commodity:{code:'PKE'}})},voucher:{aggregate:async()=>({_sum:{amountPkr:50000}})},counterpartyLedgerEntry:{aggregate:async()=>({_sum:{amountPkr:60009.95}})}} as unknown as Prisma.TransactionClient;
 const check=await canFundTruck({counterpartyId:'buyer',tradeRef:'port-sale',amountPkr:1000},db);
 assert.equal(check.ok,false);assert.match(check.reason??'',/full payment/);
});

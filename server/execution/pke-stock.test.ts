import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Prisma} from '@prisma/client';
import {physicalStock} from './sesame-stock';
import {isPakistanPhysicalSale} from './sesame-sale-reservation';
test('port sale does not subtract warehouse stock; warehouse arrivals and dispatches do',async()=>{
 const db={trade:{findMany:async()=>[{tradeRef:'PKE'}]},inboundReceipt:{findMany:async()=>[{warehouseName:'A',status:'ALLOCATED',allocatedQtyMt:50}]},outboundDispatch:{findMany:async()=>[{warehouseName:'Port: Karachi',status:'WEIGHED',allocatedQtyMt:50},{warehouseName:'A',status:'WEIGHED',allocatedQtyMt:10}]},pendingTruck:{findMany:async()=>[]},stockTransfer:{findMany:async()=>[]}} as unknown as Prisma.TransactionClient;
 const result=await physicalStock(db,'PKE');assert.equal(result.has('Port: Karachi'),false);assert.equal(result.get('A'),40);
 assert.equal(isPakistanPhysicalSale('SELL',{tradingEntity:'Kastros Pakistan',pkePortFileId:'vessel'}),false);
 assert.equal(isPakistanPhysicalSale('SELL',{tradingEntity:'Kastros Pakistan'}),true);
});

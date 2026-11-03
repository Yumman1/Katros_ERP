import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pkeReceiptQuote} from './pke-receipt-quote';
test('expected receipt uses full locked sale quantity, not remaining shipment weight',()=>{const q=pkeReceiptQuote(200,50,0,0,0);assert.equal(q.agreedPkr,10000000);assert.equal(q.availablePkr,10000000);});
test('approved and pending receipts reduce amount available for another voucher',()=>{const q=pkeReceiptQuote(100,25,0,500000,250000);assert.equal(q.remainingPkr,2000000);assert.equal(q.availablePkr,1750000);});
test('billed charges are explicit, rounded and paid balances never become negative',()=>{const q=pkeReceiptQuote(1,50,51000,10000,1000);assert.equal(q.billedExtraPkr,1000);assert.equal(q.availablePkr,40000);assert.equal(pkeReceiptQuote(1,50,0,50000,10).availablePkr,0);});

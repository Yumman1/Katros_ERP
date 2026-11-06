import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pkeShortage} from './pke-shipment-review';
test('insurance requires loss beyond tolerance and uses full missing weight',()=>{assert.deepEqual(pkeShortage(200,195,2),{missing:5,claimable:true});assert.equal(pkeShortage(200,198,2).claimable,false);assert.equal(pkeShortage(200,200,2).claimable,false);assert.throws(()=>pkeShortage(200,NaN,2));});

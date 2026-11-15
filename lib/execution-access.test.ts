import test from 'node:test';
import assert from 'node:assert/strict';
import {executionScope} from './execution-access';

test('execution accounts cannot change entity through request headers',()=>{
 assert.equal(executionScope({role:'EXECUTION',executionEntity:'FZCO'},new Headers({'x-execution-entity':'PAK','x-execution-commodity':'PKE'})).executionEntity,'FZCO');
 assert.equal(executionScope({role:'EXECUTION',executionEntity:'PAK'},new Headers({'x-execution-entity':'FZCO'})).executionEntity,'PAK');
});
test('Dubai supports Sesame and PKE only, including when scope headers are omitted',()=>{
 assert.equal(executionScope({role:'EXECUTION',executionEntity:'FZCO'},new Headers()).executionCommodityCode,'SES');
 for(const code of ['SES','PKE'])assert.equal(executionScope({role:'EXECUTION',executionEntity:'FZCO'},new Headers({'x-execution-commodity':code})).executionCommodityCode,code);
 assert.throws(()=>executionScope({role:'EXECUTION',executionEntity:'FZCO'},new Headers({'x-execution-commodity':'CORN'})));
});

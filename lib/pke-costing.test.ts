import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePkeCost,DEFAULT_PKE_COST_POLICY as policy,validatePkeCostPolicy,validatePkeCostPatch} from './pke-costing';
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<0.01,`${actual} vs ${expected}`);
test('reconciles detailed spreadsheet totals at 24,200 MT, USD 227.50 and FX 278.5',()=>{
 const r=calculatePkeCost({invoiceAmount:5505500,quantityMt:24200,currency:'USD',exchangeRate:278.5},policy);
 near(r.customsBase,1549543736.2405);near(r.exPort,2016234290.7802141);near(r.exWarehouse,2070079290.7802141);near(r.delivered,2084599290.7802141);near(r.perMt,86140.466561165871);near(r.perBag,4307.0233280582934);
 near(r.lines.reduce((s,l)=>s+l.amount,0),r.delivered);
});
test('PKR and USD inputs produce the same estimate',()=>{
 const input={quantityMt:100,exchangeRate:278.5};
 near(calculatePkeCost({...input,invoiceAmount:22750,currency:'USD'},policy).delivered,calculatePkeCost({...input,invoiceAmount:22750*278.5,currency:'PKR'},policy).delivered);
});
test('tax policy changes flow through cascading tax bases',()=>{
 const input={invoiceAmount:22750,quantityMt:100,currency:'USD' as const,exchangeRate:278.5};
 const before=calculatePkeCost(input,policy),after=calculatePkeCost(input,{...policy,customsDutyPct:5});
 assert.ok(after.taxes>before.taxes+before.customsBase*.05);
 const doubled=calculatePkeCost({...input,invoiceAmount:45500,quantityMt:200},policy);near(doubled.delivered,before.delivered*2);
});
test('rejects missing or invalid inputs and rates',()=>{
 const input={invoiceAmount:22750,quantityMt:100,currency:'USD' as const,exchangeRate:278.5};
 assert.throws(()=>calculatePkeCost({...input,quantityMt:0},policy));assert.throws(()=>calculatePkeCost({...input,exchangeRate:NaN},policy));assert.throws(()=>validatePkeCostPolicy({...policy,salesTaxPct:101}));
});

test('cost ownership prevents cross-department and unknown writes',()=>{
 assert.deepEqual(validatePkeCostPatch({salesTaxPct:18},'FINANCE'),{salesTaxPct:18});
 assert.deepEqual(validatePkeCostPatch({insurancePct:.06,cessPct:.8,transportPerMt:2000},'EXECUTION'),{insurancePct:.06,cessPct:.8,transportPerMt:2000});
 assert.throws(()=>validatePkeCostPatch({insurancePct:.06},'FINANCE'));
 assert.throws(()=>validatePkeCostPatch({salesTaxPct:18},'EXECUTION'));
 assert.throws(()=>validatePkeCostPatch({unknown:1},'EXECUTION'));
 assert.throws(()=>validatePkeCostPatch({},'FINANCE'));
 assert.throws(()=>validatePkeCostPatch({exchangeRate:0},'EXECUTION'));
});
test('execution expense changes recalculate landed cost without altering tax rates',()=>{
 const input={invoiceAmount:22750,quantityMt:100,currency:'USD' as const,exchangeRate:278.5};
 const before=calculatePkeCost(input,policy);
 const after=calculatePkeCost(input,{...policy,...validatePkeCostPatch({transportPerMt:2500},'EXECUTION')});
 near(after.delivered-before.delivered,50000);near(after.taxes,before.taxes);
 const insured=calculatePkeCost(input,{...policy,insurancePct:1});
 assert.ok(insured.customsBase>before.customsBase);assert.ok(insured.taxes>before.taxes);
});

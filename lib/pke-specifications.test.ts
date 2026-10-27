import assert from "node:assert/strict";
import { test } from "node:test";
import { PKE_DEFAULTS, PKE_FIELDS, SESAME_DEFAULTS, normalizeSesameParams, sesameFields } from "./sesame";
import { qualitySummaryFromParams, resolveAllTradeParameters } from "./trade-parameters";

test("PKE has four specifications and no type selector", () => {
  const fields = sesameFields(PKE_DEFAULTS, "PKE");
  assert.deepEqual(fields.filter(f => f.group === "quality").map(f => f.key), ["profat", "fibre", "moisture", "sandSilica"]);
  assert.equal(fields.some(f => f.key === "sesameType"), false);
  const params = normalizeSesameParams(PKE_DEFAULTS, "LC", "PKE");
  assert.equal(params.profat, 21);
  assert.equal(params.fibre, 20);
  assert.equal(params.moisture, 12);
  assert.equal(params.sandSilica, 3);
  const summary = qualitySummaryFromParams(params, resolveAllTradeParameters("PKE", null));
  assert.equal(summary, "Profat (min): 21 %; Fibre (max): 20 %; Moisture (max): 12 %; Sand and/or Silica (max): 3 %");
});

test("PKE saves its specs, removes copied sesame fields and keeps entity/payment terms", () => {
  const params = normalizeSesameParams({...SESAME_DEFAULTS,...PKE_DEFAULTS,sesameType:"Sortex",colour:"Ivory",tradingEntity:"Kastros FZCO",paymentPercentage:80}, "ADVANCE_100", "PKE");
  for (const key of ["sesameType", "purity", "ffa", "oilContent", "admixture", "colour"]) assert.equal(params[key], undefined);
  assert.equal(params.tradingEntity,"Kastros FZCO");
  assert.equal(params.paymentPercentage,80);
  for (const field of PKE_FIELDS.filter(f=>f.group==="quality")) {
    for (const value of [-1,101,"",undefined]) assert.throws(()=>normalizeSesameParams({...PKE_DEFAULTS,[field.key]:value},"LC","PKE"),/between 0 and 100/);
  }
  assert.equal(normalizeSesameParams(SESAME_DEFAULTS,"LC","SES").sesameType,"Machine Cleaned");
  assert.equal(sesameFields(SESAME_DEFAULTS,"SES").some(f=>f.key==="purity"),true);
});

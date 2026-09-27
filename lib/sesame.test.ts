import assert from "node:assert/strict";
import { test } from "node:test";
import { SESAME_DEFAULTS, SESAME_TYPES, normalizeSesameParams, sesameNetPrice, sesameTradingEntity } from "./sesame";
import { incotermsForBooking } from "./trade-constants";
import { toPricePerCanonicalQty } from "./price-units";

test("inclusive Sesame price deducts commission once across quote units", () => {
  for (const [price, commission, currency, kgPerUnit] of [
    [1200, 10, "USD", 1000], [120000, 1000, "USd", 1000], [1.2, 0.01, "USD", 1],
  ] as const) {
    const metric = { currency, weightUnit: kgPerUnit === 1 ? "KG" : "MT", kgPerUnit };
    const net = toPricePerCanonicalQty(sesameNetPrice(price, commission)!, metric, 1000) * 500;
    const fee = toPricePerCanonicalQty(commission, metric, 1000) * 500;
    assert.ok(Math.abs(net - 595000) < 0.000001);
    assert.equal(fee, 5000);
    assert.ok(Math.abs(net + fee - 600000) < 0.000001);
  }
  assert.equal(sesameNetPrice(1200, 0), 1200);
  assert.equal(sesameNetPrice(undefined), undefined);
  for (const fee of [-1, 1200, 1300, NaN]) assert.throws(() => sesameNetPrice(1200, fee), /Commission/);
});

test("CNF is an international Sesame incoterm, never a Sesame type", () => {
  assert.ok(!(SESAME_TYPES as readonly string[]).includes("CNF"));
  for (const direction of ["BUY", "SELL"] as const) {
    assert.ok(incotermsForBooking(direction, "INTERNATIONAL", "SES").includes("CNF"));
    assert.ok(incotermsForBooking(direction, "INTERNATIONAL", "OTHER", "Sesame").includes("CNF"));
    assert.ok(!incotermsForBooking(direction, "LOCAL", "SES").includes("CNF"));
    assert.ok(!incotermsForBooking(direction, "INTERNATIONAL", "CORN").includes("CNF"));
    assert.deepEqual(incotermsForBooking(direction, "LOCAL", "CORN"), ["EXW", "Delivered"]);
  }
});

test("entity options persist and legacy routes resolve without changing scope", () => {
  for (const tradingEntity of ["Kastros FZCO", "Kastros PAK"]) {
    assert.equal(normalizeSesameParams({ ...SESAME_DEFAULTS, tradingEntity }, "LC").tradingEntity, tradingEntity);
  }
  assert.equal(sesameTradingEntity({ tradeRoute: "Dubai" }), "Kastros FZCO");
  assert.equal(sesameTradingEntity({ tradeRoute: "Local" }), "Kastros PAK");
  const old = { ...SESAME_DEFAULTS, tradingEntity: undefined, tradeRoute: "Dubai" };
  assert.equal(normalizeSesameParams(old, "LC").tradeRoute, undefined);
  assert.throws(() => normalizeSesameParams({ ...SESAME_DEFAULTS, tradingEntity: "Invalid" }, "LC"), /entity/);
  assert.throws(() => normalizeSesameParams({ ...SESAME_DEFAULTS, sesameType: "CNF" }, "LC"), /Sesame type/);
});

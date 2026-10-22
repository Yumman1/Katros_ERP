import assert from "node:assert/strict";
import { test } from "node:test";
import { formatQty, formatQtyWithUnit, formatDisplayNumber, formatDisplayFixed, formatPct, formatCurrency } from "./numbers";

test("display formatters suppress only rounded negative zero", () => {
  for (const value of [-0, -1e-13, -0.0004, 0]) {
    assert.equal(formatDisplayNumber(value, "en-PK", { maximumFractionDigits: 3 }), "0");
    assert.equal(formatDisplayFixed(value, 3), "0.000");
  }
  assert.equal(formatDisplayNumber(-0.0005, "en-PK", { maximumFractionDigits: 3 }), "-0.001");
  assert.equal(formatDisplayNumber(-595.07, "en-PK", { maximumFractionDigits: 3 }), "-595.07");
  assert.equal(formatDisplayFixed(-0.001, 3), "-0.001");
  assert.equal(formatPct(-1e-13), "0.00%");
  assert.equal(formatCurrency(-1e-13), "$0.00");
});

test("signed zero formats as unsigned zero", () => {
  assert.equal(formatQty(-0), "0.00");
  assert.equal(formatQty(-0.0001), "0.00");
  assert.equal(formatQty(-0.004), "0.00");
  assert.equal(formatQtyWithUnit(-0, "MT", 1), "0.0 MT");
  assert.equal(formatQtyWithUnit(-0.04, "MT", 1), "0.0 MT");
  assert.equal(formatQty(-94.48), "-94.48");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatQty, formatQtyWithUnit } from "./numbers";

test("signed zero formats as unsigned zero", () => {
  assert.equal(formatQty(-0), "0.00");
  assert.equal(formatQty(-0.0001), "0.00");
  assert.equal(formatQty(-0.004), "0.00");
  assert.equal(formatQtyWithUnit(-0, "MT", 1), "0.0 MT");
  assert.equal(formatQtyWithUnit(-0.04, "MT", 1), "0.0 MT");
  assert.equal(formatQty(-94.48), "-94.48");
});

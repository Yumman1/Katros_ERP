import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NOTE_SETTLE_TOLERANCE_PKR,
  noteRemainingPkr,
  noteShouldClose,
} from "./ledger";

describe("noteRemainingPkr", () => {
  it("returns full billed when nothing paid", () => {
    assert.equal(noteRemainingPkr(700_000, 0), 700_000);
  });

  it("sums partial vouchers toward remaining due", () => {
    assert.equal(noteRemainingPkr(700_000, 200_000), 500_000);
    assert.equal(noteRemainingPkr(700_000, 699_600), 400);
  });

  it("never returns negative remaining", () => {
    assert.equal(noteRemainingPkr(700_000, 800_000), 0);
  });
});

describe("noteShouldClose", () => {
  it("keeps note open when remaining is above tolerance", () => {
    assert.equal(noteShouldClose(501), false);
    assert.equal(noteShouldClose(NOTE_SETTLE_TOLERANCE_PKR + 1), false);
  });

  it("closes note when remaining is within 500 PKR tolerance", () => {
    assert.equal(noteShouldClose(500), true);
    assert.equal(noteShouldClose(0), true);
    assert.equal(noteShouldClose(499.99), true);
  });
});

describe("partial note voucher rules (pure)", () => {
  it("rejects voucher above remaining", () => {
    const remaining = noteRemainingPkr(700_000, 200_000);
    const voucher = 600_000;
    assert.ok(voucher > remaining + 0.005);
  });

  it("allows partial voucher within remaining", () => {
    const remaining = noteRemainingPkr(700_000, 200_000);
    const voucher = 300_000;
    assert.ok(voucher <= remaining + 0.005);
  });

  it("closes after partial series within tolerance", () => {
    const billed = 700_000;
    let paid = 0;
    paid += 400_000;
    assert.equal(noteShouldClose(noteRemainingPkr(billed, paid)), false);
    paid += 299_600;
    assert.equal(noteRemainingPkr(billed, paid), 400);
    assert.equal(noteShouldClose(noteRemainingPkr(billed, paid)), true);
  });
});

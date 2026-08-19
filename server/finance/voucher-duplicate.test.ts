import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeVoucherBankKey,
  normalizeVoucherReference,
  voucherDateCalendarKey,
  vouchersSharePaymentKey,
} from "./vouchers";

describe("vouchersSharePaymentKey", () => {
  const base = {
    bankName: "HBL",
    reference: "TXN-12345",
    voucherDate: new Date("2026-08-20T12:00:00.000Z"),
    amountPkr: 500_000,
  };

  it("matches when bank, reference, date, and amount are the same", () => {
    assert.equal(
      vouchersSharePaymentKey(base, {
        ...base,
        bankName: " hbl ",
        reference: "txn-12345",
        voucherDate: new Date("2026-08-20T18:30:00.000Z"),
      }),
      true,
    );
  });

  it("does not match when reference differs", () => {
    assert.equal(vouchersSharePaymentKey(base, { ...base, reference: "TXN-99999" }), false);
  });

  it("does not match when bank differs", () => {
    assert.equal(vouchersSharePaymentKey(base, { ...base, bankName: "MCB" }), false);
  });

  it("does not match when date differs", () => {
    assert.equal(
      vouchersSharePaymentKey(base, { ...base, voucherDate: new Date("2026-08-21T00:00:00.000Z") }),
      false,
    );
  });

  it("does not match when amount differs beyond rounding", () => {
    assert.equal(vouchersSharePaymentKey(base, { ...base, amountPkr: 500_001 }), false);
  });

  it("treats empty bank as equivalent for non-transfer methods", () => {
    assert.equal(
      normalizeVoucherBankKey(null),
      normalizeVoucherBankKey(""),
    );
    assert.equal(
      vouchersSharePaymentKey(
        { ...base, bankName: null },
        { ...base, bankName: "" },
      ),
      true,
    );
  });
});

describe("normalizeVoucherReference", () => {
  it("trims and lowercases", () => {
    assert.equal(normalizeVoucherReference("  ABC-99  "), "abc-99");
  });
});

describe("voucherDateCalendarKey", () => {
  it("uses UTC calendar day", () => {
    assert.equal(voucherDateCalendarKey(new Date("2026-08-20T23:59:59.000Z")), "2026-08-20");
  });
});

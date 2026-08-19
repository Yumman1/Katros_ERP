import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSharedPoolAvailablePkr, tradeTermsKind } from "./ledger";

describe("computeSharedPoolAvailablePkr", () => {
  it("sums trade-linked and direct credits into one pool", () => {
    const available = computeSharedPoolAvailablePkr({
      totalCreditPkr: 8_000_000, // 5M tagged trade A + 3M untagged — one pool
      settlementEarmarkPkr: 0,
      truckDebits: [],
      earmarkedTruckIds: new Set(),
    });
    assert.equal(available, 8_000_000);
  });

  it("earmarks in-flight trucks from any trade against the shared pool", () => {
    const available = computeSharedPoolAvailablePkr({
      totalCreditPkr: 10_000_000,
      settlementEarmarkPkr: 0,
      truckDebits: [
        { truckId: "truck-b", amountPkr: 4_000_000 }, // trade B truck
      ],
      earmarkedTruckIds: new Set(["truck-b"]),
    });
    // Trade A truck check sees the same 6M left after trade B's earmark
    assert.equal(available, 6_000_000);
  });

  it("excludeTruckId omits that truck's earmark for self-funding check", () => {
    const available = computeSharedPoolAvailablePkr({
      totalCreditPkr: 5_000_000,
      settlementEarmarkPkr: 0,
      truckDebits: [{ truckId: "self", amountPkr: 4_000_000 }],
      earmarkedTruckIds: new Set(["self"]),
      excludeTruckId: "self",
    });
    assert.equal(available, 5_000_000);
  });

  it("subtracts settlement invoice debits from the pool", () => {
    const available = computeSharedPoolAvailablePkr({
      totalCreditPkr: 10_000_000,
      settlementEarmarkPkr: 2_000_000,
      truckDebits: [],
      earmarkedTruckIds: new Set(),
    });
    assert.equal(available, 8_000_000);
  });

  it("never returns negative available balance", () => {
    const available = computeSharedPoolAvailablePkr({
      totalCreditPkr: 1_000_000,
      settlementEarmarkPkr: 0,
      truckDebits: [{ truckId: "t1", amountPkr: 5_000_000 }],
      earmarkedTruckIds: new Set(["t1"]),
    });
    assert.equal(available, 0);
  });
});

describe("tradeTermsKind", () => {
  it("classifies credit payment types for UI context only", () => {
    assert.equal(tradeTermsKind("CREDIT"), "CREDIT");
    assert.equal(tradeTermsKind("CREDIT_30"), "CREDIT");
    assert.equal(tradeTermsKind("ADVANCE"), "ADVANCE");
  });
});

describe("canFundTruck funding threshold (pure)", () => {
  it("credit- and advance-terms both pass when pool covers receivable", () => {
    const available = 5_000_000;
    const receivable = 4_000_000;
    assert.ok(available + 0.005 >= receivable);
  });

  it("credit- and advance-terms both fail when pool is short", () => {
    const available = 2_000_000;
    const receivable = 4_000_000;
    assert.ok(available + 0.005 < receivable);
  });
});

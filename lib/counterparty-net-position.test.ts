import assert from "node:assert/strict";
import { test } from "node:test";
import { counterpartyNetPositions, type NetPositionAccount } from "./counterparty-net-position";
const entry = (patch: Partial<NetPositionAccount["entries"][number]> = {}): NetPositionAccount["entries"][number] => ({ entryType: "DEBIT", sourceType: "GATEPASS", amountPkr: 1000, billedPkr: 1000, paidPkr: 0, noteStatus: null, settlesNoteRef: null, ...patch });
const account = (side: "BUY" | "SELL", entries: NetPositionAccount["entries"]): NetPositionAccount => ({ counterpartyId: "cp1", counterpartyName: "Buyer and seller", counterpartyCode: "CP1", side, entries });
test("net combines sale receipts and partly paid purchases without changing account balances", () => {
  const rows = [account("SELL", [entry(), entry({ entryType: "CREDIT", sourceType: "VOUCHER", amountPkr: 200 })]), account("BUY", [entry({ paidPkr: 700, amountPkr: 700 })])];
  const before = JSON.stringify(rows);
  const [r] = counterpartyNetPositions(rows);
  assert.equal(r.receivablePkr, 800); assert.equal(r.payablePkr, 300); assert.equal(r.netPkr, 500);
  assert.equal(JSON.stringify(rows), before);
});
test("buyer advance is money we owe, not receivable", () => {
  const [r] = counterpartyNetPositions([account("SELL", [entry({ entryType: "CREDIT", sourceType: "VOUCHER", amountPkr: 500 })])]);
  assert.equal(r.payablePkr, 500); assert.equal(r.netPkr, -500);
});
test("fully paid purchase and legacy payment credit do not create a false receivable", () => {
  const [r] = counterpartyNetPositions([account("BUY", [entry({ paidPkr: 1000 }), entry({ sourceType: "PAYMENT", entryType: "CREDIT", amountPkr: 1000 })])]);
  assert.equal(r.netPkr, 0);
});
test("sell receipts are subtracted once, even when a truck is settled", () => {
  const [r] = counterpartyNetPositions([account("SELL", [entry({ paidPkr: 1000 }), entry({ entryType: "CREDIT", sourceType: "VOUCHER", amountPkr: 1000 })])]);
  assert.equal(r.netPkr, 0);
});
for (const side of ["BUY", "SELL"] as const) for (const type of ["DEBIT", "CREDIT"] as const) {
  test(`partial ${side} ${type} note uses remaining claim and excludes its voucher`, () => {
    const [r] = counterpartyNetPositions([account(side, [entry({ sourceType: "ADJUSTMENT", entryType: type, noteStatus: "UNPAID", paidPkr: 400 }), entry({ sourceType: "VOUCHER", entryType: "CREDIT", amountPkr: 400, settlesNoteRef: "NOTE1" })])]);
    const sign = (side === "SELL" ? 1 : -1) * (type === "DEBIT" ? 1 : -1);
    assert.equal(r.netPkr, sign * 600);
  });
}
test("closed note and its vouchers have zero net effect", () => {
  const [r] = counterpartyNetPositions([account("BUY", [entry({ sourceType: "ADJUSTMENT", noteStatus: "PAID" }), entry({ sourceType: "VOUCHER", entryType: "CREDIT", settlesNoteRef: "NOTE1" })])]);
  assert.equal(r.netPkr, 0);
});
test("purchase settlement invoice credits reduce invoice only once", () => {
  const [r] = counterpartyNetPositions([account("BUY", [entry({ sourceType: "INVOICE", paidPkr: 1000 }), entry({ sourceType: "VOUCHER", entryType: "CREDIT", amountPkr: 1000 })])]);
  assert.equal(r.netPkr, 0);
});

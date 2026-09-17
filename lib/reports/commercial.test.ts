import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommercialReport, costBatchSales, pakistanDay, periodKey, type ReportMovement, type ReportFilters } from "./commercial";
const movement = (patch: Partial<ReportMovement>): ReportMovement => ({ id: "buy1", date: "2026-01-01T00:00:00.000Z", direction: "BUY", tradeRef: "BUY-1", traderName: "Trader A", commodityId: "corn", commodity: "Corn", counterpartyId: "seller", counterparty: "Seller", warehouse: "A", quantityKg: 1000, amount: 100000, currency: "PKR", batchRefs: ["B1"], invalidBatchLink: false, reference: "KCS-1", ...patch });
const filters: ReportFilters = { from: "2026-02-01", to: "2026-02-28", basis: "delivered", groupBy: "month" };
const sale = (patch: Partial<ReportMovement> = {}) => movement({ id: "sell1", direction: "SELL", tradeRef: "SELL-1", date: "2026-02-02T00:00:00.000Z", quantityKg: 400, amount: 60000, counterpartyId: "buyer", counterparty: "Buyer", reference: "GP1", ...patch });
test("partial batch sale compares only cost of sold quantity", () => {
  const [s] = costBatchSales([sale(), movement({})]);
  assert.equal(s.purchaseCost, 40000); assert.equal(s.profit, 20000);
});
test("moving average carries remaining cost, including receipts added after earlier sale", () => {
  const rows = costBatchSales([movement({}), sale({ date: "2026-01-02T00:00:00.000Z", quantityKg: 500 }), movement({ id: "buy2", date: "2026-01-03T00:00:00.000Z", quantityKg: 500, amount: 150000, reference: "KCS2" }), sale({ id: "sell2", quantityKg: 500, amount: 90000 })]);
  assert.equal(rows[1].purchaseCost, 100000); assert.equal(rows[1].profit, -10000);
});
test("prior-period sales consume batch quantity before report filtering", () => {
  const result = buildCommercialReport([movement({}), sale({ id: "earlier", date: "2026-01-02T00:00:00.000Z", quantityKg: 800 }), sale()], filters);
  assert.equal(result.sales.length, 1); assert.equal(result.sales[0].profit, null);
  assert.match(result.sales[0].costReason, /Insufficient/);
});
test("buyer/warehouse filtering does not discard the historical purchase cost", () => {
  const r = buildCommercialReport([movement({ warehouse: "Original" }), sale()], { ...filters, counterpartyId: "buyer", warehouse: "A" });
  assert.equal(r.purchases.length, 0); assert.equal(r.sales[0].purchaseCost, 40000);
});
test("future purchases cannot fund earlier sale", () => {
  const [r] = costBatchSales([sale(), movement({ date: "2026-02-05T00:00:00.000Z" })]);
  assert.equal(r.profit, null);
});
test("multi-batch quantity ambiguity is not allocated arbitrarily", () => {
  const [r] = costBatchSales([movement({ batchRefs: ["B1", "B2"] }), sale()]);
  assert.equal(r.profit, null); assert.match(r.costReason, /Multiple batches/);
});
test("uncosted sale consumes availability and blocks later reuse", () => {
  const rows = costBatchSales([movement({}), sale({ id: "first", amount: null }), sale({ id: "second", date: "2026-02-03T00:00:00.000Z" })]);
  assert.equal(rows[0].profit, null); assert.equal(rows[1].profit, null);
});
test("different currencies and commodity mismatches are not combined", () => {
  assert.equal(costBatchSales([movement({ currency: "USD" }), sale()])[0].profit, null);
  assert.equal(costBatchSales([movement({ invalidBatchLink: true }), sale()])[0].profit, null);
});
test("missing cost never becomes a zero-cost profit", () => {
  const report = buildCommercialReport([sale({ batchRefs: [] })], filters);
  assert.equal(report.commodities[0].profit, null); assert.equal(report.commodities[0].uncostedCount, 1);
  assert.equal(report.commodities[0].matchedProfit, 0);
});
test("trader report output is scoped, while consuming earlier sales by other traders", () => {
  const r = buildCommercialReport([movement({ traderName: "Other" }), sale({ id: "earlier", traderName: "Other", date: "2026-01-02T00:00:00.000Z", quantityKg: 800 }), sale()], filters, "Trader A");
  assert.equal(r.sales.length, 1); assert.equal(r.purchases.length, 0); assert.equal(r.sales[0].profit, null);
  assert.deepEqual(r.options.counterparties.map((x) => x.id), ["buyer"]);
});
test("Pakistan period boundaries and Monday week grouping are independent of server timezone", () => {
  assert.equal(pakistanDay("2026-01-31T19:00:00.000Z"), "2026-02-01");
  assert.equal(periodKey("2026-02-01", "week"), "2026-01-26");
  const r = buildCommercialReport([sale({ date: "2026-01-31T19:00:00.000Z" })], filters);
  assert.equal(r.sales.length, 1);
});
test("booked basis does not pretend to have realized batch profit", () => {
  const r = buildCommercialReport([movement({ date: sale().date }), sale()], { ...filters, basis: "booked" });
  assert.equal(r.sales[0].profit, null); assert.equal(r.commodities[0].purchaseMinusSales, 40000);
});
test("currencies stay in separate summary groups and no input arrays are mutated", () => {
  const rows = [sale(), sale({ id: "usd", currency: "USD" })]; const before = JSON.stringify(rows);
  const r = buildCommercialReport(rows, filters);
  assert.equal(r.commodities.length, 2); assert.equal(JSON.stringify(rows), before);
});
test("an empty trader identity never grants firm-wide data", () => {
  const r = buildCommercialReport([movement({}), sale()], filters, "");
  assert.equal(r.sales.length, 0); assert.equal(r.options.commodities.length, 0);
});
test("previous month compares full calendar periods and includes commodities with no current sales", () => {
  const r = buildCommercialReport([sale({ id: "old", date: "2026-01-31T12:00:00.000Z", commodityId: "wheat", commodity: "Wheat", amount: 500 }), sale()], filters);
  assert.deepEqual(r.previousRange, { from: "2026-01-01", to: "2026-01-31" });
  const wheat = r.comparisons.find((c) => c.commodity === "Wheat")!;
  assert.equal(wheat.sales, 0); assert.equal(wheat.previousSales, 500); assert.equal(wheat.changePct, -100);
});
test("custom reporting range compares the preceding equal number of days", () => {
  const r = buildCommercialReport([], { ...filters, from: "2026-02-10", to: "2026-02-15" });
  assert.deepEqual(r.previousRange, { from: "2026-02-04", to: "2026-02-09" });
});

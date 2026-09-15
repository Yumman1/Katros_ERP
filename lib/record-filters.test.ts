import assert from "node:assert/strict";
import test from "node:test";
import { calendarDay, emptyFilters, field, filterRecords, restoreFilters, tradeFilterConfig, type FilterState } from "./record-filters";
import { paginateItems } from "./list-pagination";

const trades = [
  { tradeRef: "BUY-1", direction: "BUY", commodity: { code: "CORN" }, counterparty: { name: "Alpha" }, tradeScope: "LOCAL", tradeDate: "2026-09-12T19:00:00Z", deliveryStart: "2026-09-20", quantity: 100 },
  { tradeRef: "SELL-1", direction: "SELL", commodity: { code: "CORN" }, counterparty: { name: "Alpha" }, tradeScope: "LOCAL", tradeDate: "2026-09-13T18:59:59.999Z", deliveryStart: "2026-09-21", quantity: 200 },
  { tradeRef: "BUY-2", direction: "BUY", commodity: { code: "SESAME" }, counterparty: { name: "Beta" }, tradeScope: "INTERNATIONAL", tradeDate: "2026-09-13T19:00:00Z", deliveryStart: "2026-10-01", quantity: 50 },
];
const state = (patch: Partial<FilterState>) => ({ ...emptyFilters(), ...patch });

test("all filters cleared preserves every record, identity and original ordering", () => {
  const result = filterRecords(trades, emptyFilters(), tradeFilterConfig);
  assert.deepEqual(result, trades);
  result.forEach((row, i) => assert.equal(row, trades[i]));
});
test("single calendar day includes midnight and the last millisecond in Pakistan", () => {
  assert.deepEqual(filterRecords(trades, state({ dateMode: "day", from: "2026-09-13" }), tradeFilterConfig).map((r) => r.tradeRef), ["BUY-1", "SELL-1"]);
  assert.equal(calendarDay("2026-09-12T18:59:59.999Z"), "2026-09-12");
  assert.equal(calendarDay(new Date("2026-09-13T19:00:00Z")), "2026-09-14");
});
test("date-only values stay unchanged and invalid/missing dates never match a selected day", () => {
  assert.equal(calendarDay("2026-09-13"), "2026-09-13");
  for (const value of [undefined, null, "", "not a date", "2026-02-30", new Date(NaN)]) assert.equal(calendarDay(value), "");
  const rows = [{ tradeDate: null }, { tradeDate: "2026-09-13" }];
  assert.equal(filterRecords(rows, emptyFilters(), tradeFilterConfig).length, 2);
  assert.equal(filterRecords(rows, state({ dateMode: "day", from: "2026-09-13" }), tradeFilterConfig).length, 1);
});
test("side, commodity, market, counterparty, search and date combine with AND", () => {
  const s = state({ search: " buy-1 ", selected: { side: "BUY", commodity: "CORN", market: "LOCAL", counterparty: "Alpha" }, dateMode: "day", from: "2026-09-13" });
  assert.deepEqual(filterRecords(trades, s, tradeFilterConfig), [trades[0]]);
  assert.equal(filterRecords(trades, { ...s, selected: { ...s.selected, side: "SELL" } }, tradeFilterConfig).length, 0);
});
test("inclusive, one-sided and invalid ranges", () => {
  assert.equal(filterRecords(trades, state({ dateMode: "range", from: "2026-09-13", to: "2026-09-14" }), tradeFilterConfig).length, 3);
  assert.equal(filterRecords(trades, state({ dateMode: "range", to: "2026-09-13" }), tradeFilterConfig).length, 2);
  assert.equal(filterRecords(trades, state({ dateMode: "range", from: "2026-09-14" }), tradeFilterConfig).length, 1);
  assert.equal(filterRecords(trades, state({ dateMode: "range", from: "2026-09-14", to: "2026-09-13" }), tradeFilterConfig).length, 0);
});
test("delivery range is separate from trade date", () => {
  assert.deepEqual(filterRecords(trades, state({ dateMode: "day", from: "2026-09-13", deliveryFrom: "2026-09-21", deliveryTo: "2026-09-21" }), tradeFilterConfig), [trades[1]]);
});
test("sorting never mutates the cached source or its records", () => {
  const source = Object.freeze(trades.map((r) => Object.freeze({ ...r })));
  assert.deepEqual(filterRecords(source, state({ sort: "quantity-desc" }), tradeFilterConfig).map((r) => r.quantity), [200, 100, 50]);
  assert.deepEqual(source.map((r) => r.quantity), [100, 200, 50]);
  assert.equal(filterRecords(source, state({ sort: "date-desc" }), tradeFilterConfig)[0], source[2]);
});
test("draft and contract date paths do not substitute update or lock dates", () => {
  const rows = [ { payload: { form: { tradeDate: "2026-09-13" } }, updatedAt: "2026-09-14" }, { contractDate: new Date("2026-09-13T00:00:00Z"), lockedAt: "2026-09-14" }, { updatedAt: "2026-09-13" } ];
  assert.equal(filterRecords(rows, state({ dateMode: "day", from: "2026-09-13" }), tradeFilterConfig).length, 2);
});
test("warehouse selection matches any allocation without changing quantities", () => {
  const row = { warehouseAllocationProgress: [{ warehouseName: "Lahore", qty: 50 }, { warehouseName: "Karachi", qty: 100 }] };
  const config = { fields: [field("warehouse", "Warehouse", "warehouseAllocationProgress.warehouseName")] };
  assert.deepEqual(filterRecords([row], state({ selected: { warehouse: "Karachi" } }), config), [row]);
  assert.equal(row.warehouseAllocationProgress.length, 2);
});
test("filter before pagination finds matches beyond the first page and exports all matches", () => {
  const source = Array.from({ length: 31 }, (_, i) => ({ ...trades[i % 3], tradeRef: `REF-${i}`, direction: i >= 20 ? "SELL" : "BUY" }));
  const matches = filterRecords(source, state({ selected: { side: "SELL" } }), tradeFilterConfig);
  const page = paginateItems(matches, 1, 6);
  assert.equal(matches.length, 11);
  assert.equal(page.items.length, 6);
  assert.equal(page.items[0].tradeRef, "REF-20");
});
test("persisted selections are validated and unrelated fields cannot break a screen", () => {
  assert.deepEqual(restoreFilters({ search: {}, dateMode: "bad", selected: { side: 42 }, sort: "bad", from: false }), emptyFilters());
  assert.equal(filterRecords(trades, state({ selected: { unsupported: "value" } }), tradeFilterConfig).length, 3);
});
test("same selections apply to refreshed results without modifying workflow status", () => {
  const selected = state({ selected: { side: "BUY" } });
  const refreshed = [{ ...trades[0], tradeStatus: "LOCKED" }, { ...trades[1], tradeStatus: "EXECUTED" }];
  assert.equal(filterRecords(refreshed, selected, tradeFilterConfig)[0].tradeStatus, "LOCKED");
  assert.equal(refreshed[1].tradeStatus, "EXECUTED");
});

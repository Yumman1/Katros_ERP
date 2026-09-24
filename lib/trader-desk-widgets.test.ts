import assert from "node:assert/strict";
import { test } from "node:test";
import { committedTradeTotals, restoreHiddenWidgets, widgetStorageKey, DESK_WIDGETS } from "./trader-desk-widgets";
import { filterRecords, emptyFilters, restoreFilters, tradeFilterConfig } from "./record-filters";

test("committed volume includes completed contracts but excludes drafts, cancellations and cash-only settlements", () => {
  const trade = (direction: string, quantity: number, tradeStatus: string, directSettled = false) => ({ direction, quantity, tradeStatus, directSettled });
  assert.deepEqual(committedTradeTotals([
    trade("BUY", 10, "LOCKED"), trade("BUY", 4, "EXECUTED"), trade("SELL", 6, "CONFIRMED"),
    trade("BUY", 100, "PENDING"), trade("SELL", 100, "CANCELLED"), trade("SELL", 50, "SETTLED", true),
  ]), { totalBoughtMt: 14, totalSoldMt: 6 });
  assert.deepEqual(committedTradeTotals([]), { totalBoughtMt: 0, totalSoldMt: 0 });
});
test("MTM ranks positive, zero and negative USD values; unavailable values last; input unchanged", () => {
  const rows = [{ mtm: null }, { mtm: -30 }, { mtm: 0 }, { mtm: 15 }, { mtm: NaN }, { mtm: -2 }];
  const order = filterRecords(rows, { ...emptyFilters(), sort: "mtm-desc" }, { mtmPaths: ["mtm"] });
  assert.deepEqual(order.map(x => x.mtm), [15, 0, -2, -30, null, NaN]);
  assert.equal(rows[0].mtm, null);
  assert.equal(restoreFilters({ sort: "mtm-desc" }).sort, "mtm-desc");
});
test("removed fulfillment filters cannot keep hiding rows, other list filters remain functional", () => {
  const rows = [{ commodityCode: "SES", counterpartyName: "B", tradeDate: "2026-09-24", direction: "BUY" }];
  const saved = { ...emptyFilters(), search: "unmatched", selected: { commodity: "CORN", counterparty: "A" }, dateMode: "day" as const, from: "2000-01-01" };
  const fulfillment = { ...tradeFilterConfig, search: false, date: undefined, fields: tradeFilterConfig.fields!.filter(f => !["commodity", "counterparty"].includes(f.key)) };
  assert.equal(filterRecords(rows, saved, fulfillment).length, 1);
  assert.equal(filterRecords(rows, saved, tradeFilterConfig).length, 0);
});
test("widget choices are validated, allow an empty desk, and are isolated by user and commodity", () => {
  assert.deepEqual(restoreHiddenWidgets(null), []);
  assert.deepEqual(restoreHiddenWidgets(["inventory", "inventory", "unknown", 4]), ["inventory"]);
  assert.equal(restoreHiddenWidgets(DESK_WIDGETS.map(w => w.id)).length, DESK_WIDGETS.length);
  assert.notEqual(widgetStorageKey("saad", "sesame"), widgetStorageKey("fahad", "sesame"));
  assert.notEqual(widgetStorageKey("saad", "sesame"), widgetStorageKey("saad", "corn"));
  assert.ok(!DESK_WIDGETS.some(w => /Pending confirmation/i.test(w.label)));
});

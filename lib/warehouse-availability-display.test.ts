import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WarehouseAvailabilityBadges } from "@/components/trader/warehouse-availability-badges";
import { WarehouseMultiSelect } from "@/components/trader/warehouse-multi-select";

// tsx uses the repository's preserve JSX setting outside Next's compiler.
Object.assign(globalThis, { React });
const warehouse = {
  id: "w1", name: "Warehouse", storageDivision: "grain" as const,
  trueAvailableMt: 750, trueAvailabilityPct: 75,
  divisionAvailableMt: 999, divisionAvailabilityPct: 99,
  stockOnHandMt: 250, bookedQtyMt: 100, freeToSellMt: 150,
};
const render = (direction: "BUY" | "SELL", row = warehouse) => renderToStaticMarkup(
  React.createElement(WarehouseAvailabilityBadges, { warehouse: row, bookingDirection: direction, storageDivision: "grain" }),
);

test("buy review shows physical spare capacity and percentage, using booking's exact badges", () => {
  const badges = render("BUY");
  assert.match(badges, /Available 750\.0 MT/);
  assert.match(badges, /75%/);
  assert.doesNotMatch(badges, /999/);
  const booking = renderToStaticMarkup(React.createElement(WarehouseMultiSelect, {
    warehouses: [warehouse], value: [], onChange: () => {}, storageDivision: "grain", bookingDirection: "BUY",
  }));
  assert.ok(booking.includes(badges));
});

test("sell review shows stock, booked and free to sell, using booking's exact badges", () => {
  const badges = render("SELL");
  assert.match(badges, /Stock 250\.0 MT/);
  assert.match(badges, /Booked 100\.0 MT/);
  assert.match(badges, /Free to sell 150\.0 MT/);
  assert.doesNotMatch(badges, /Available 750/);
  const booking = renderToStaticMarkup(React.createElement(WarehouseMultiSelect, {
    warehouses: [warehouse], value: [], onChange: () => {}, storageDivision: "grain", bookingDirection: "SELL",
  }));
  assert.ok(booking.includes(badges));
});

test("zero spare capacity and zero free stock are displayed as zero with warning styling", () => {
  assert.match(render("BUY", { ...warehouse, trueAvailableMt: 0, trueAvailabilityPct: 0 }), /Available 0\.0 MT.*0%/);
  const sell = render("SELL", { ...warehouse, freeToSellMt: 0 });
  assert.match(sell, /Free to sell 0\.0 MT/);
  assert.match(sell, /text-destructive/);
});

test("missing stock data is unavailable rather than a misleading zero balance", () => {
  const badges = renderToStaticMarkup(React.createElement(WarehouseAvailabilityBadges, {
    warehouse: { id: "missing", name: "Unconfigured" }, bookingDirection: "SELL",
  }));
  assert.match(badges, /Stock availability unavailable/);
  assert.doesNotMatch(badges, /0\.0 MT/);
});

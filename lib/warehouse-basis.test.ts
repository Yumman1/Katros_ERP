import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateWarehouseCapacity } from "./warehouse-basis";
import { computeWarehouseAvailability } from "./warehouse-availability";
import { buildWarehouseUtilizationView } from "./warehouse-utilization";
import { computeWarehouseCosting } from "./warehouse-costing";
import { WarehouseAvailabilityBadges } from "../components/trader/warehouse-availability-badges";
import { WarehouseMultiSelect } from "../components/trader/warehouse-multi-select";
import { WarehouseStorageMetricsPreview } from "../components/execution/warehouse-storage-metrics-preview";
Object.assign(globalThis, { React });
const stock = { stockMt: 1991, stockBales: 0 };
const use = { id: "use", name: "MA oil", warehouseBasis: "USE" as const, capacitySqFt: 100, grainDivisionSqFt: 7 };

test("use basis accepts no capacity; lease basis requires a positive finite capacity", () => {
  assert.doesNotThrow(() => validateWarehouseCapacity({ warehouseBasis: "USE" }));
  for (const capacitySqFt of [undefined, null, 0, -1, Infinity, NaN]) {
    assert.throws(() => validateWarehouseCapacity({ warehouseBasis: "LEASE", capacitySqFt }), /positive capacity/);
  }
  assert.doesNotThrow(() => validateWarehouseCapacity({ warehouseBasis: "LEASE", capacitySqFt: 20000, grainDivisionSqFt: 6.24 }));
  assert.throws(() => validateWarehouseCapacity({ warehouseBasis: "OTHER" as "USE" }));
});

test("use basis ignores stale capacity and keeps unbounded capacity null, with reporting utilization 100", () => {
  const [row] = computeWarehouseAvailability([use], [], [], [], null, { code: "SES" },
    new Map([["ma oil", { allocatedMt: 1991, unallocatedMt: 500, stock }]]));
  assert.equal(row.warehouseBasis, "USE");
  assert.equal(row.utilizationPct, 100);
  assert.equal(row.allocatedInvMt, 1991);
  for (const field of ["capacitySqFt", "capacityMt", "grainDivisionSqFt", "trueAvailableMt", "trueAvailabilityPct", "remainingSqFt"] as const) assert.equal(row[field], null, field);
  assert.equal(buildWarehouseUtilizationView(use, stock), null);
  assert.equal(computeWarehouseCosting(use), null);
});

test("use-basis buy stays selectable without capacity warnings; sell retains real stock restrictions", () => {
  const warehouse = { ...use, trueAvailableMt: 0, trueAvailabilityPct: 0, stockOnHandMt: 1991, bookedQtyMt: 91, freeToSellMt: 1900 };
  const buy = renderToStaticMarkup(React.createElement(WarehouseMultiSelect, { warehouses: [warehouse], value: [], onChange: () => {}, bookingDirection: "BUY", storageDivision: "grain" }));
  assert.match(buy, /confirm space by phone/);
  assert.doesNotMatch(buy, /Available 0|disabled|Set capacity|Grain division/);
  const sell = renderToStaticMarkup(React.createElement(WarehouseAvailabilityBadges, { warehouse, bookingDirection: "SELL", requestedQtyMt: 2000 }));
  assert.match(sell, /Stock 1,991\.0 MT/);
  assert.match(sell, /Booked 91\.0 MT/);
  assert.match(sell, /Free to sell 1,900\.0 MT/);
  assert.match(sell, /text-destructive/);
});

test("lease shared-floor availability accounts for grain and cotton, including unassigned and transferred stock", () => {
  const lease = { id: "l", name: "Lease", warehouseBasis: "LEASE" as const, capacitySqFt: 10000, grainDivisionSqFt: 10, balesDivisionSqFt: 20 };
  const [row] = computeWarehouseAvailability([lease], [], [], [], null, { code: "SES", category: "OILSEEDS" },
    new Map([["lease", { allocatedMt: 300, unallocatedMt: 100, stock: { stockMt: 300, stockBales: 100 } }]]));
  assert.equal(row.utilizationPct, 50);
  assert.equal(row.trueAvailableMt, 500);
  assert.equal(row.trueAvailabilityPct, 50);
});

test("unknown mixed-stock divisions are not fabricated, and use-basis approval has no capacity prompt", () => {
  assert.equal(buildWarehouseUtilizationView({ capacitySqFt: 47000, grainDivisionSqFt: null, balesDivisionSqFt: null }, { stockMt: 594, stockBales: 218 }), null);
  const preview = renderToStaticMarkup(React.createElement(WarehouseStorageMetricsPreview, { payload: { warehouseBasis: "USE" } }));
  assert.match(preview, /No fixed capacity/);
  assert.doesNotMatch(preview, /Enter capacity|Total Storage Capacity/);
});

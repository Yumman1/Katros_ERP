import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLocationCommodityInventory } from "./inventory-stock";
import { computeWarehouseAvailability } from "./warehouse-availability";

function inventory(status: string, received = 100) {
  return buildLocationCommodityInventory({
    inbound: [{ warehouseName: "Warehouse", tradeRef: "BUY", allocatedQtyMt: received, status: "ALLOCATED" }],
    outbound: [{ warehouseName: "Warehouse", tradeRef: "SELL", allocatedQtyMt: 100, status }],
    pendingTrucks: [],
    commodityForTradeRef: () => ({ code: "SES", name: "Sesame", unit: "MT" }),
  })[0];
}

test("weighing and finance approval reserve stock without freeing warehouse space", () => {
  for (const status of ["WEIGHED", "FINANCE_PENDING"]) {
    const row = inventory(status);
    assert.equal(row.netQty, 0);
    assert.equal(row.physicalQty, 100);
    const [warehouse] = computeWarehouseAvailability([
      { id: "w", name: "Warehouse", capacitySqFt: 1000, grainDivisionSqFt: 5, balesDivisionSqFt: 10 },
    ], [], [], [], null, { code: "SES" }, new Map([["warehouse", {
      allocatedMt: row.allocatedQty, unallocatedMt: row.unallocatedQty,
      stock: { stockMt: row.physicalQty + 20, stockBales: 0 },
    }]]));
    // Sesame plus 20 MT of corn share the grain division.
    assert.equal(warehouse.utilizationPct, 60);
  }
});

test("only released gate-out removes physical stock", () => {
  assert.equal(inventory("AT_GATE").physicalQty, 100);
  assert.equal(inventory("RELEASED").physicalQty, 0);
  assert.equal(inventory("RELEASED", 150).physicalQty, 50);
});

test("empty use-basis warehouse reports zero rather than permanent occupancy", () => {
  const [warehouse] = computeWarehouseAvailability([
    { id: "w", name: "Warehouse", warehouseBasis: "USE" },
  ], [], [], []);
  assert.equal(warehouse.utilizationPct, 0);
});

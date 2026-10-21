import assert from "node:assert/strict";
import { test } from "node:test";
import { lockWarehouseAllocationLines } from "./warehouse-allocation";

const resolve = (hint: string) => (hint.toLowerCase() === "umar" ? "Umar Warehouse" : hint);

test("spot lock keeps Excel / selected warehouse", () => {
  const lines = lockWarehouseAllocationLines({
    paperOwnership: false,
    requiresWarehouse: false,
    profile: "PURCHASE_SPOT",
    splitPlan: [],
    traderSelections: [],
    destName: "Umar",
    qtyMt: 11,
    resolveName: resolve,
  });
  assert.deepEqual(lines, [{ warehouseName: "Umar Warehouse", qtyMt: 11 }]);
});

test("spot lock without a yard writes nothing", () => {
  const lines = lockWarehouseAllocationLines({
    paperOwnership: false,
    requiresWarehouse: false,
    profile: "PURCHASE_SPOT",
    splitPlan: [],
    traderSelections: [],
    destName: "",
    qtyMt: 11,
    resolveName: resolve,
  });
  assert.deepEqual(lines, []);
});

test("delivered lock still needs the approved split", () => {
  const lines = lockWarehouseAllocationLines({
    paperOwnership: false,
    requiresWarehouse: true,
    warehouseSplitApproved: false,
    profile: "PURCHASE_DELIVERED",
    splitPlan: [{ warehouseName: "Umar Warehouse", openQtyMt: 20 }],
    traderSelections: [],
    destName: "Umar Warehouse",
    qtyMt: 20,
    resolveName: resolve,
  });
  assert.deepEqual(lines, []);
});

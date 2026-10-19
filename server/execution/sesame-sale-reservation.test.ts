import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookedPakistanSaleKgAtWarehouse,
  unassignedPakistanSaleMt,
} from "./sesame-sale-reservation";

const open = {
  contractStatus: "Open",
  openQtyMt: 1000,
  quantityUnit: "MT",
  warehouseAllocations: [] as { warehouseName: string; qtyMt: unknown; fulfilledQtyMt: unknown }[],
};

test("unallocated Pakistan sales are not reserved at every warehouse", () => {
  const t = {
    tradeRef: "KAS-2026-133",
    direction: "SELL",
    tradeParams: { tradingEntity: "Kastros PAK", internalCounterpartyEntity: "FZCO", sesameType: "Machine Cleaned" },
    quantity: 1000,
    quantityUnit: "MT",
    contract: open,
  };
  assert.equal(bookedPakistanSaleKgAtWarehouse(t, "MA oil", "Machine Cleaned"), 0);
  assert.equal(unassignedPakistanSaleMt(t), 1000);
});

test("allocated remaining qty is reserved only at that warehouse", () => {
  const t = {
    tradeRef: "KAS-2026-135",
    direction: "SELL",
    tradeParams: { tradingEntity: "Kastros PAK", internalCounterpartyEntity: "FZCO", sesameType: "Machine Cleaned" },
    quantity: 4,
    quantityUnit: "MT",
    contract: {
      ...open,
      openQtyMt: 4,
      warehouseAllocations: [{ warehouseName: "MA oil", qtyMt: 4, fulfilledQtyMt: 0 }],
    },
  };
  assert.equal(bookedPakistanSaleKgAtWarehouse(t, "MA oil", "Machine Cleaned"), 4000);
  assert.equal(bookedPakistanSaleKgAtWarehouse(t, "Umar Warehouse", "Machine Cleaned"), 0);
  assert.equal(bookedPakistanSaleKgAtWarehouse(t, "MA oil", "Machine Cleaned", "KAS-2026-135"), 0);
  assert.equal(unassignedPakistanSaleMt(t), 0);
});

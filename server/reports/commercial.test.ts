import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { commercialReportInput, getCommercialReport } from "./commercial";
const filters = { from: "2026-02-01", to: "2026-02-28", basis: "delivered" as const, groupBy: "month" as const };
const trade = { tradeRef: "T1", traderName: "Trader A", commodityId: "corn", counterpartyId: "cp1", quantityUnit: "MT", currency: "PKR",
  commodity: { id: "corn", code: "CORN", name: "Corn", unit: "MT", canonicalKgPerUnit: 1000 }, counterparty: { id: "cp1", name: "Counterparty" },
  contract: { quantityUnit: "MT", currency: "PKR" }, traceabilityLinks: [{ batch: { batchRef: "B1", commodityId: "corn" } }] };
test("input rejects impossible dates and reversed ranges", () => {
  assert.equal(commercialReportInput.safeParse({ ...filters, from: "2026-02-30" }).success, false);
  assert.equal(commercialReportInput.safeParse({ ...filters, from: "2026-03-01" }).success, false);
  assert.equal(commercialReportInput.safeParse(filters).success, true);
});
test("delivered query uses released dispatches, real receipt totals and a Pakistan end boundary", async () => {
  let purchaseQuery: any; let saleQuery: any;
  const db = {
    inboundReceipt: { findMany: (q: any) => { purchaseQuery = q; return Promise.resolve([{ id: "receipt", kcsNo: "KCS1", tradeRef: "T1", receiveDate: new Date("2026-01-01"), allocatedQtyMt: 1, amountDue: 80000, warehouseName: "A", trade }]); } },
    outboundDispatch: { findMany: (q: any) => { saleQuery = q; return Promise.resolve([{ id: "sale", gatepassNo: "GP1", tradeRef: "S1", dispatchDate: new Date("2026-02-01"), invoiceWeightKg: 500, amountDue: 60000, warehouseName: "B", trade: { ...trade, tradeRef: "S1" } }]); } },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  } as unknown as PrismaClient;
  const r = await getCommercialReport(db, filters);
  assert.equal(purchaseQuery.where.status.not, "DRAFT"); assert.equal(saleQuery.where.status, "RELEASED");
  assert.equal(saleQuery.where.dispatchDate.lte.toISOString(), "2026-02-28T18:59:59.999Z");
  assert.equal(r.sales[0].purchaseCost, 40000); assert.equal(r.sales[0].profit, 20000);
});
test("unknown purchase units leave cost missing instead of assuming tonnes", async () => {
  const db = {
    inboundReceipt: { findMany: () => Promise.resolve([{ id: "receipt", kcsNo: "KCS1", tradeRef: "T1", receiveDate: new Date("2026-01-01"), allocatedQtyMt: 1, amountDue: 80000, warehouseName: "A", trade: { ...trade, contract: { quantityUnit: "UNKNOWN", currency: "PKR" } } }]) },
    outboundDispatch: { findMany: () => Promise.resolve([{ id: "sale", gatepassNo: "GP1", tradeRef: "S1", dispatchDate: new Date("2026-02-01"), invoiceWeightKg: 500, amountDue: 60000, warehouseName: "A", trade }]) },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  } as unknown as PrismaClient;
  const r = await getCommercialReport(db, filters);
  assert.equal(r.sales[0].profit, null); assert.match(r.sales[0].costReason, /unit conversion/);
});
test("booked query uses canonical pricing and only committed trade states", async () => {
  let query: any;
  const db = { trade: { findMany: (q: any) => { query = q; return Promise.resolve([{ ...trade, id: "book", direction: "SELL", tradeDate: new Date("2026-02-02"), quantity: 2, pricePerCanonicalQty: 100000, price: 4000, priceWeightUnit: "MAUND", priceCurrency: "PKR" }]); } } } as unknown as PrismaClient;
  const r = await getCommercialReport(db, { ...filters, basis: "booked" }, "Trader A");
  assert.deepEqual(query.where.tradeStatus.in, ["LOCKED", "CONFIRMED", "EXECUTED"]);
  assert.equal(r.sales[0].amount, 200000); assert.equal(r.sales[0].quantityKg, 2000); assert.equal(r.sales[0].profit, null);
});

/** Integration check: an EMPTY, disposable local database on port 55433 only. */
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../server/db";
import { appRouter } from "../server/routers/_app";
import { assignCommodityTrader } from "../server/commodity-assignments";
import { SESAME_DEFAULTS } from "../lib/sesame";
import { pakistanAvailable } from "../server/execution/sesame-stock";

async function main() {
  const url = new URL(process.env.POSTGRES_PRISMA_URL ?? "http://invalid");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "55433");
  assert.equal(await prisma.user.count(), 0, "Only an empty disposable database is allowed");
  const passwordHash = await bcrypt.hash("LocalTest123!", 4);
  const admin = await prisma.user.create({ data: { email: "admin@example.test", name: "Admin", role: "CEO", passwordHash } });
  const employee = await prisma.user.create({ data: { email: "execution@example.test", name: "Execution Member", role: "EXECUTION", passwordHash } });
  const trader = await prisma.user.create({ data: { email: "trader@example.test", name: "Test Trader", role: "TRADER", passwordHash } });
  const sesame = await prisma.commodity.create({ data: { code: "SES", name: "Sesame", category: "OILSEEDS", unit: "MT", createdById: admin.id } });
  await prisma.commodity.create({ data: { code: "CORN", name: "Corn", category: "GRAINS", unit: "MT", createdById: admin.id } });
  const cp = await prisma.counterparty.create({ data: { code: "CP-TEST", name: "Test Counterparty", country: "Pakistan", type: "TRADING_PARTNER", createdById: admin.id } });
  await assignCommodityTrader({ commodityId: sesame.id, traderId: trader.id, expectedVersion: 0, actorId: admin.id });
  const caller = (user = employee, code?: string, entity?: "PAK" | "FZCO") => appRouter.createCaller({ prisma, executionCommodityCode: code, executionEntity: entity, session: { user: { id: user.id, name: user.name, email: user.email, role: user.role, isHead: user.isHead }, expires: "2099-01-01" } });
  const pak = caller(employee, "SES", "PAK"), dubai = caller(employee, "SES", "FZCO"), head = caller(admin, "SES", "PAK"), dh = caller(admin, "SES", "FZCO");
  const book = async (direction: "BUY" | "SELL", entity: "PAK" | "FZCO", quantity: number, internal?: "PAK" | "FZCO") => caller(trader).trader.bookTrade({
    traderName: trader.name!, commodityId: sesame.id, counterpartyId: cp.id, direction, quantity, quantityUnit: "MT", price: 1200, priceIncludesCommission: true, commissionPerUnit: 10, priceCurrency: "USD", priceWeightUnit: "MT", priceKgPerUnit: 1000, priceBasis: "Fixed", tradeDate: new Date(), deliveryStart: new Date(), deliveryEnd: new Date(), originName: "Karachi", incoterms: "Delivered", paymentType: "LC", tradeScope: "LOCAL", tradeParams: { ...SESAME_DEFAULTS, tradingEntity: entity === "FZCO" ? "Kastros FZCO" : "Kastros PAK", ...(internal ? { internalCounterpartyEntity: internal } : {}) }, submitToExecution: true,
  });
  await pak.trader.setPositionMarketInput({ commodityCode: "SES", season: "SUMMER", fxRate: 280, marketRatePkrPerMaund: 14000 });
  const purchase = await book("BUY", "PAK", 100);
  await head.execution.approveOpenTradeWarehouseSplit({ tradeRef: purchase.tradeRef, allocations: [{ warehouseName: "Pakistan Store", openQtyMt: 100 }] });
  await pak.execution.lockOpenTrade({ tradeRef: purchase.tradeRef });
  const inbound = await pak.execution.createPendingTruck({ counterpartyName: cp.name, movementType: "INBOUND", warehouseName: "Pakistan Store", truckNo: "PAK-IN", builtyDetails: "Test", commodityCode: "SES", commodityName: "Sesame", recordedByName: employee.name!, weightAsPerBuiltyKg: 100000, warehouseWeightKg: 100000, totalDeductionsKg: 0 });
  await pak.execution.assignTruckToTrade({ truckId: inbound.id, tradeRef: purchase.tradeRef });
  console.log("PASS: Pakistan physical receipt, 100 MT");
  const transfer = await book("BUY", "FZCO", 40, "PAK");
  await dubai.execution.lockOpenTrade({ tradeRef: transfer.tradeRef });
  await assert.rejects(() => head.sesameExecution.confirmOwnership({ tradeRef: transfer.tradeRef, quantityMt: 40, warehouseName: "Pakistan Store" }), /paper ownership|does not hold inventory|triparty/);
  let state = await pak.sesameExecution.book();
  assert.equal(state.positions[0].ownedMt, 100);
  assert.equal(state.positions[0].physicalInPakistanMt, 100);
  assert.equal(state.warehouses.find(w => w.name === "Pakistan Store")?.quantityMt, 100);
  assert.equal(await pakistanAvailable(prisma, "SES", "Pakistan Store"), 100);
  const sale = await book("SELL", "FZCO", 15);
  await dubai.execution.lockOpenTrade({ tradeRef: sale.tradeRef });
  await assert.rejects(() => dubai.sesameExecution.loadTruck({ tradeRef: sale.tradeRef, truckNo: "FZCO-OUT", transporterName: "Test Transport", weightKg: 10000 }), /does not hold inventory/);
  assert.equal((await pak.sesameExecution.book()).positions[0].ownedMt, 100);
  const external = await book("BUY", "FZCO", 2); await dubai.execution.lockOpenTrade({ tradeRef: external.tradeRef });
  await assert.rejects(() => dh.sesameExecution.confirmOwnership({ tradeRef: external.tradeRef, quantityMt: 2, holderId: cp.id, holderLocation: "Karachi store", documentRef: "OWN-DOC-1", ownershipDate: new Date() }), /paper ownership/);
  state = await pak.sesameExecution.book();
  assert.equal(state.positions[0].physicalInPakistanMt, 100);
  assert.equal(state.positions[1].ownedMt, 0);
  assert.equal(state.positions[1].openBuyMt, 2);
  const csv = (await dubai.execution.exportTradeFileCsv({})).csv;
  assert.ok(csv.includes(sale.tradeRef) && !csv.includes(purchase.tradeRef));
  assert.equal((await caller(employee, "CORN").execution.pendingTrucks()).length, 0);
  console.log("PASS: Pakistan physical is independent of FZCO; internals cannot take warehouse stock; FZCO has no paper ownership");
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });

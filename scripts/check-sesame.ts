/** Run only against a disposable local database initialized from schema.prisma. */
import assert from "node:assert/strict";
import { prisma } from "../server/db";
import { traderRouter } from "../server/routers/trader";
import { assignCommodityTrader } from "../server/commodity-assignments";
import { SESAME_DEFAULTS, SESAME_TYPES, normalizeSesameParams, sesameFields } from "../lib/sesame";
import { paymentTypeLabel, paymentTypesForBooking } from "../lib/trade-constants";
import { exportTradeFileCsv } from "../server/trade-file-export";

async function main() {
  const url = new URL(process.env.POSTGRES_PRISMA_URL ?? "http://invalid");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/sesame_test", "Use a disposable local database named sesame_test");
  assert.equal(await prisma.user.count(), 0, "The test database must be empty");
  const ceo = await prisma.user.create({ data: { id: "test-ceo", email: "ceo@example.test", name: "Test CEO", role: "CEO", passwordHash: "unused" } });
  const saad = await prisma.user.create({ data: { id: "test-saad", email: "saad.bashir@kastros.co", name: "Saad Bashir", role: "TRADER", passwordHash: "unused" } });
  const fahad = await prisma.user.create({ data: { id: "test-fahad", email: "fahad.ahmed@kastros.co", name: "Fahad Ahmed", role: "TRADER", passwordHash: "unused" } });
  const sesame = await prisma.commodity.create({ data: { code: "SES", name: "Sesame", category: "OILSEEDS", unit: "MT", createdById: ceo.id } });
  const corn = await prisma.commodity.create({ data: { code: "CORN", name: "Corn", category: "GRAINS", unit: "MT", createdById: ceo.id } });
  const cp = await prisma.counterparty.create({ data: { code: "CP-TEST", name: "Test supplier", country: "Pakistan", type: "TRADING_PARTNER", createdById: ceo.id } });
  await assignCommodityTrader({ commodityId: sesame.id, traderId: saad.id, expectedVersion: 0, actorId: ceo.id });
  await assignCommodityTrader({ commodityId: corn.id, traderId: fahad.id, expectedVersion: 0, actorId: ceo.id });
  const caller = (user: typeof saad) => traderRouter.createCaller({ prisma, session: { user: { id: user.id, name: user.name, email: user.email, role: user.role, isHead: false }, expires: "2099-01-01" } });
  const sesameApi = caller(saad), cornApi = caller(fahad);
  assert.deepEqual((await sesameApi.myCommodityDesks()).map(c => c.code), ["SES"]);
  const input = { traderName: saad.name!, commodityId: sesame.id, counterpartyId: cp.id, direction: "BUY" as const, quantity: 10, quantityUnit: "MT", price: 100, priceBasis: "Fixed" as const, commissionPerUnit: 0, tradeDate: new Date(), deliveryStart: new Date(), deliveryEnd: new Date(), originName: "Karachi", incoterms: "Delivered" as const, paymentType: "ADVANCE_100" as const, tradeScope: "INTERNATIONAL" as const, tradeParams: { ...SESAME_DEFAULTS, sesameType: "Sortex", colour: "Ivory", tradeRoute: "Dubai", paymentPercentage: 35 } };
  const draft = await sesameApi.saveBookingDraft({ payload: { form: { commodityId: sesame.id }, tradeParams: input.tradeParams } });
  const restored = await sesameApi.bookingDraft({ id: draft.id });
  assert.deepEqual(restored.payload.tradeParams, input.tradeParams);
  const booked = await sesameApi.bookTrade(input);
  const persisted = await sesameApi.tradeByRef({ tradeRef: booked.tradeRef });
  assert.equal(persisted?.paymentTerms, "35% Advance");
  assert.equal(persisted?.tradeParams?.colour, "Ivory");
  assert.equal(persisted?.tradeParams?.tradeRoute, "Dubai");
  assert.equal(persisted?.tradeScope, "INTERNATIONAL");
  assert.equal(persisted?.maxMoisturePct, 7);
  assert.match(persisted?.qualityTolerances ?? "", /Purity.*99/);
  assert.equal(persisted?.qualityTolerancesDetail, null);
  for (const type of SESAME_TYPES) {
    const p = normalizeSesameParams({ ...SESAME_DEFAULTS, sesameType: type, colour: "White" }, "LC");
    assert.equal("colour" in p, type === "Sortex");
    assert.equal(sesameFields(p).some(d => d.key === "colour"), type === "Sortex");
  }
  await assert.rejects(() => cornApi.bookTrade(input), /not assigned/);
  await assert.rejects(() => sesameApi.bookTrade({ ...input, tradeParams: { ...input.tradeParams, paymentPercentage: 101 } }), /percentage/);
  await assert.rejects(() => sesameApi.bookTrade({ ...input, tradeParams: { ...input.tradeParams, moisture: -1 } }), /Moisture/);
  await assert.rejects(() => sesameApi.bookTrade({ ...input, tradeParams: { ...input.tradeParams, tradeRoute: "Invalid" } }), /route/);
  const edited = await sesameApi.updateDraftTrade({ tradeRef: booked.tradeRef, patch: { paymentType: "AFTER_DELIVERY_100", tradeParams: { sesameType: "Raw", tradeRoute: "Local", paymentPercentage: 65, purity: 98 } } });
  assert.equal(edited.trade.paymentTerms, "65% After Delivery");
  assert.equal(edited.trade.tradeParams?.colour, undefined);
  assert.equal(edited.trade.tradeParams?.tradeRoute, "Local");
  assert.match(edited.trade.qualityTolerances ?? "", /98/);
  assert.ok(!(await exportTradeFileCsv({ commodityCode: "SES" })).includes("100% After Delivery"));
  const cornBooking = await cornApi.bookTrade({ ...input, traderName: fahad.name!, commodityId: corn.id, season: "WINTER", tradeScope: "LOCAL", paymentType: "CREDIT", creditDays: 45, tradeParams: { creditDays: 45 } });
  assert.equal(cornBooking.trade.season, "WINTER");
  assert.equal(cornBooking.trade.paymentTerms, "45 Day Credit");
  assert.equal(paymentTypeLabel("ADVANCE_100"), "100% Advance");
  assert.ok(!paymentTypesForBooking(true, "LOCAL").includes("DP"));
  // The CEO can assign several desks. Every summary/list stays on the selected commodity.
  await assignCommodityTrader({ commodityId: corn.id, traderId: saad.id, expectedVersion: 1, actorId: ceo.id });
  const saadCorn = await sesameApi.bookTrade({ ...input, commodityId: corn.id, season: "SUMMER", tradeParams: {} });
  assert.equal((await sesameApi.myTrades({ commodityId: sesame.id })).length, 1);
  assert.equal((await sesameApi.myTrades({ commodityId: corn.id }))[0].tradeRef, saadCorn.tradeRef);
  assert.equal((await sesameApi.deskSummary({ commodityId: sesame.id })).openTrades, 1);
  assert.equal((await sesameApi.myExposure({ commodityId: sesame.id }))[0]?.code, "SES");
  // A transfer revokes the old owner's desk and booking permission without rewriting trade history.
  await assignCommodityTrader({ commodityId: sesame.id, traderId: fahad.id, expectedVersion: 1, actorId: ceo.id });
  assert.deepEqual((await sesameApi.myCommodityDesks()).map(c => c.code), ["CORN"]);
  await assert.rejects(() => sesameApi.myTrades({ commodityId: sesame.id }), /not assigned/);
  await assert.rejects(() => sesameApi.bookTrade(input), /not assigned/);
  assert.equal((await cornApi.myCommodityDesks())[0]?.code, "SES");
  await assert.rejects(() => assignCommodityTrader({ commodityId: sesame.id, traderId: saad.id, expectedVersion: 2, actorId: saad.id }), /CEO/);
  await prisma.user.update({ where: { id: fahad.id }, data: { disabled: true } });
  await assert.rejects(() => cornApi.bookTrade(input), /enabled trader/);
  console.log("PASS: Sesame booking/persistence/editing, all five types, route independence, payment validation, Corn regression, desk isolation, CEO transfer and disabled-user checks");
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import { test } from "node:test";
import { isSesameCommodity, usesSesameWorkflow } from "./sesame";
import { canonicalizeInternalPakSale, belongsToSesameDesk, deskSide, closesOnPayment, presentTraderBook } from "./sesame-entity";
import { isGrainCommodityCode, incotermsForBooking } from "./trade-constants";
import { tickerSymbol } from "./desk-market-price-meta";
import { buildLocationCommodityInventory } from "./inventory-stock";

test("PKE shares the workflow but keeps its own commodity identity", () => {
  assert.equal(usesSesameWorkflow("PKE"), true);
  assert.equal(usesSesameWorkflow("SES"), true);
  assert.equal(usesSesameWorkflow("CORN"), false);
  assert.equal(isSesameCommodity("PKE"), false);
  assert.equal(isGrainCommodityCode("PKE"), true);
  assert.equal(tickerSymbol("PKE"), "PKE");
  assert.ok(incotermsForBooking("BUY", "INTERNATIONAL", "PKE").includes("CNF"));
});

test("PKE FZCO purchase mirrors as Pakistan sale and remains one trader purchase", () => {
  const result = canonicalizeInternalPakSale("PKE", "BUY", {tradingEntity:"Kastros FZCO",internalCounterpartyEntity:"PAK"}, "INTERCO-PAK");
  assert.equal(result.internalPakSale, true);
  assert.equal(result.direction, "SELL");
  for (const entity of ["PAK", "FZCO"] as const) assert.ok(belongsToSesameDesk("PKE",result.params,entity));
  assert.equal(deskSide("PKE",result.direction,result.params,"FZCO"),"BUY");
  assert.ok(closesOnPayment("PKE",result.direction,"INTERNATIONAL",result.params));
  const [shown] = presentTraderBook([{direction:result.direction,commodity:{code:"PKE"},tradeParams:result.params,counterparty:{name:"Dubai FZCO"}}]);
  assert.equal(shown.direction,"BUY");
  assert.equal(shown.counterparty.name,"Kastros Pakistan");
});

test("PKE and Sesame warehouse quantities stay separate", () => {
  const rows = buildLocationCommodityInventory({inbound:[{warehouseName:"Shared",tradeRef:"PKE",allocatedQtyMt:20,status:"ALLOCATED"},{warehouseName:"Shared",tradeRef:"SES",allocatedQtyMt:30,status:"ALLOCATED"}],outbound:[],pendingTrucks:[],commodityForTradeRef:code=>({code,name:code,unit:"MT"})});
  assert.equal(rows.find(r=>r.commodityCode==="PKE")?.physicalQty,20);
  assert.equal(rows.find(r=>r.commodityCode==="SES")?.physicalQty,30);
});

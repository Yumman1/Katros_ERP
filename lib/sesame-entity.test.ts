import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeInternalPakSale,
  closesOnPayment,
  FZCO_NO_PAKISTAN_WAREHOUSE,
  FZCO_NO_PAPER_OWNERSHIP,
  internalPakSale,
  isFzcoBuyFromPakistan,
  paperTrade,
  sesameBookQty,
  shouldCloseOnFullPayment,
} from "./sesame-entity";

const sesame = "SES";
const pakSellFzco = { tradingEntity: "Kastros PAK", internalCounterpartyEntity: "FZCO" };
const fzcoSell = { tradingEntity: "Kastros FZCO" };
const fzcoBuy = { tradingEntity: "Kastros FZCO" };
const pakExternal = { tradingEntity: "Kastros PAK" };

test("FZCO does not hold inventory in Pakistan warehouses", () => {
  assert.match(FZCO_NO_PAKISTAN_WAREHOUSE, /does not hold inventory in Pakistan warehouses/);
  assert.match(FZCO_NO_PAPER_OWNERSHIP, /does not confirm paper ownership/);
});

test("internal Pakistan → FZCO sale is a physical trade, not paper ownership", () => {
  assert.equal(internalPakSale(sesame, "SELL", pakSellFzco), true);
  assert.equal(paperTrade(sesame, pakSellFzco), false);
  assert.equal(paperTrade(sesame, fzcoBuy), true);
  assert.equal(paperTrade("CORN", pakSellFzco), false);
});

test("FZCO buy from Pakistan canonicalizes to the Pakistan warehouse sale", () => {
  const fzcoFromPak = { tradingEntity: "Kastros FZCO", internalCounterpartyEntity: "PAK" };
  assert.equal(isFzcoBuyFromPakistan(sesame, "BUY", fzcoFromPak, "INTERCO-PAK"), true);
  assert.equal(isFzcoBuyFromPakistan(sesame, "BUY", fzcoBuy, "INTERCO-PAK"), true);
  assert.equal(isFzcoBuyFromPakistan(sesame, "BUY", fzcoBuy, "CP-00117"), false);
  assert.equal(paperTrade(sesame, fzcoBuy, { direction: "BUY", counterpartyCode: "INTERCO-PAK" }), false);
  const out = canonicalizeInternalPakSale(sesame, "BUY", fzcoFromPak, "INTERCO-PAK");
  assert.equal(out.direction, "SELL");
  assert.equal(out.internalPakSale, true);
  assert.equal(out.params.tradingEntity, "Kastros PAK");
  assert.equal(out.params.internalCounterpartyEntity, "FZCO");
  assert.equal(internalPakSale(sesame, out.direction, out.params), true);
  assert.equal(paperTrade(sesame, out.params), false);
  const already = canonicalizeInternalPakSale(sesame, "SELL", pakSellFzco);
  assert.equal(already.internalPakSale, true);
  assert.equal(already.direction, "SELL");
});

test("payment closing applies to the internal PAK sale and all FZCO books", () => {
  assert.equal(closesOnPayment(sesame, "SELL", "INTERNATIONAL", pakSellFzco), true);
  assert.equal(closesOnPayment(sesame, "SELL", "INTERNATIONAL", fzcoSell), true);
  assert.equal(closesOnPayment(sesame, "SELL", "LOCAL", fzcoSell), true);
  assert.equal(closesOnPayment(sesame, "SELL", "INTERNATIONAL", pakExternal), false);
  assert.equal(closesOnPayment(sesame, "BUY", "INTERNATIONAL", fzcoBuy), true);
  assert.equal(closesOnPayment("CORN", "SELL", "INTERNATIONAL", pakSellFzco), false);
});

test("internal payment-open sales stay on the book after the stock has left", () => {
  const shipped = { quantityMt: 4, openMt: 0, receivedMt: 4, internal: true, closeOnPayment: true, contractStatus: "Open" as const };
  const unshipped = { quantityMt: 2, openMt: 2, receivedMt: 0, internal: true, closeOnPayment: true, contractStatus: "Open" as const };
  assert.equal(sesameBookQty({ ...shipped, asEntity: "PAK" }), 4);
  assert.equal(sesameBookQty({ ...shipped, asEntity: "FZCO" }), 4);
  assert.equal(sesameBookQty({ ...unshipped, asEntity: "PAK" }), 2);
  assert.equal(sesameBookQty({ ...unshipped, asEntity: "FZCO" }), 2);
  assert.equal(sesameBookQty({ ...shipped, contractStatus: "Close", asEntity: "PAK" }), 0);
  assert.equal(sesameBookQty({ quantityMt: 4, openMt: 0, receivedMt: 4, internal: false, closeOnPayment: true, contractStatus: "Open", asEntity: "FZCO" }), 4);
  assert.equal(sesameBookQty({ quantityMt: 4, openMt: 0, receivedMt: 4, internal: false, closeOnPayment: true, contractStatus: "Close", asEntity: "FZCO" }), 0);
});

test("payment-close helper waits for BL invoices and shipped quantity", () => {
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 0, receivedPkr: 100, contractualQtyMt: 10, fulfilledQtyMt: 10, toleranceMt: 0 }), false);
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 100, receivedPkr: 99.99, contractualQtyMt: 10, fulfilledQtyMt: 10, toleranceMt: 0 }), false);
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 100, receivedPkr: 100, contractualQtyMt: 10, fulfilledQtyMt: 9, toleranceMt: 0 }), false);
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 100, receivedPkr: 100, contractualQtyMt: 10, fulfilledQtyMt: 9.5, toleranceMt: 0.5 }), true);
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 100, receivedPkr: 100.01, contractualQtyMt: 10, fulfilledQtyMt: 10, toleranceMt: 0 }), true);
});

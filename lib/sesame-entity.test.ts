import assert from "node:assert/strict";
import { test } from "node:test";
import { closesOnPayment, internalPakSale, paperTrade, shouldCloseOnFullPayment } from "./sesame-entity";

const sesame = "SES";
const pakSellFzco = { tradingEntity: "Kastros PAK", internalCounterpartyEntity: "FZCO" };
const fzcoSell = { tradingEntity: "Kastros FZCO" };
const fzcoBuy = { tradingEntity: "Kastros FZCO" };
const pakExternal = { tradingEntity: "Kastros PAK" };

test("internal Pakistan → FZCO sale is a physical trade, not paper ownership", () => {
  assert.equal(internalPakSale(sesame, "SELL", pakSellFzco), true);
  assert.equal(paperTrade(sesame, pakSellFzco), false);
  assert.equal(paperTrade(sesame, fzcoBuy), true);
  assert.equal(paperTrade("CORN", pakSellFzco), false);
});

test("payment closing applies only to the internal PAK sale and FZCO international sales", () => {
  assert.equal(closesOnPayment(sesame, "SELL", "INTERNATIONAL", pakSellFzco), true);
  assert.equal(closesOnPayment(sesame, "SELL", "INTERNATIONAL", fzcoSell), true);
  assert.equal(closesOnPayment(sesame, "SELL", "LOCAL", fzcoSell), false);
  assert.equal(closesOnPayment(sesame, "SELL", "INTERNATIONAL", pakExternal), false);
  assert.equal(closesOnPayment(sesame, "BUY", "INTERNATIONAL", fzcoBuy), false);
  assert.equal(closesOnPayment("CORN", "SELL", "INTERNATIONAL", pakSellFzco), false);
});

test("payment-close helper waits for BL invoices and shipped quantity", () => {
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 0, receivedPkr: 100, contractualQtyMt: 10, fulfilledQtyMt: 10, toleranceMt: 0 }), false);
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 100, receivedPkr: 99.99, contractualQtyMt: 10, fulfilledQtyMt: 10, toleranceMt: 0 }), false);
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 100, receivedPkr: 100, contractualQtyMt: 10, fulfilledQtyMt: 9, toleranceMt: 0 }), false);
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 100, receivedPkr: 100, contractualQtyMt: 10, fulfilledQtyMt: 9.5, toleranceMt: 0.5 }), true);
  assert.equal(shouldCloseOnFullPayment({ invoicedPkr: 100, receivedPkr: 100.01, contractualQtyMt: 10, fulfilledQtyMt: 10, toleranceMt: 0 }), true);
});

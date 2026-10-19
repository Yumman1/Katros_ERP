import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TRIPARTY_PAK_BEFORE_BUYER,
  tripartyPakistanOverpayMessage,
  tripartyPakistanPaymentError,
} from "./triparty-pakistan-payment";

const sale = (amount: number, status = "APPROVED") => ({
  side: "SELL",
  status,
  amountPkr: amount,
});
const buy = (amount: number, status = "PENDING_FINANCE", id?: string) => ({
  id,
  side: "BUY",
  status,
  amountPkr: amount,
});
const bl = (vouchers: { side: string; status: string; amountPkr: number; id?: string }[]) => ({
  triparty: true,
  status: "BL_RECORDED",
  vouchers,
});

test("FZCO cannot pay Pakistan before the buyer pays Dubai FZCO", () => {
  assert.equal(tripartyPakistanPaymentError({ amountPkr: 1000, shipments: [] }), TRIPARTY_PAK_BEFORE_BUYER);
  assert.equal(
    tripartyPakistanPaymentError({ amountPkr: 1000, shipments: [bl([sale(1000, "PENDING_FINANCE")])] }),
    TRIPARTY_PAK_BEFORE_BUYER,
  );
});

test("FZCO can pay Pakistan only up to approved buyer receipts", () => {
  assert.equal(tripartyPakistanPaymentError({ amountPkr: 4000, shipments: [bl([sale(4000)])] }), null);
  assert.equal(
    tripartyPakistanPaymentError({ amountPkr: 4001, shipments: [bl([sale(4000)])] }),
    tripartyPakistanOverpayMessage(4000),
  );
  assert.equal(
    tripartyPakistanPaymentError({
      amountPkr: 1500,
      shipments: [bl([sale(4000), buy(3000)])],
    }),
    tripartyPakistanOverpayMessage(4000),
  );
  assert.equal(
    tripartyPakistanPaymentError({
      amountPkr: 1000,
      shipments: [bl([sale(4000), buy(3000)])],
    }),
    null,
  );
});

test("pending Pakistan payment on the trade counts against the buyer-paid cap", () => {
  assert.equal(
    tripartyPakistanPaymentError({
      amountPkr: 2000,
      shipments: [bl([sale(4000)])],
      otherPakPaymentsPkr: 2500,
    }),
    tripartyPakistanOverpayMessage(4000),
  );
});

test("the voucher being approved is not counted twice", () => {
  assert.equal(
    tripartyPakistanPaymentError({
      amountPkr: 4000,
      shipments: [bl([sale(4000), buy(4000, "PENDING_FINANCE", "v1")])],
      excludeVoucherId: "v1",
    }),
    null,
  );
});

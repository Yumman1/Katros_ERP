/**
 * Names of the business-reference counters held in "RefCounter".
 *
 * Allocation lives in server/db/serials.ts, which reconciles a counter against
 * the references already issued before handing out a number. There is
 * deliberately no plain increment helper here — a counter that has fallen
 * behind a bulk load will re-issue a number that exists, and the insert dies on
 * the unique index.
 */
export const COUNTER = {
  TRADE: "trade",
  INBOUND: "inbound",
  PAYMENT: "payment",
  TRUCK_INBOUND: "gatepass-inbound",
  TRUCK_OUTBOUND: "gatepass-outbound",
  CHANGE_REQUEST: "change-request",
  COUNTERPARTY: "counterparty",
  WAREHOUSE: "warehouse",
  VOUCHER: "voucher",
  SETTLEMENT_INVOICE: "settlement-invoice",
  GATE_OUT_SLIP: "gate-out-slip",
  DELIVERY_ORDER: "delivery-order",
  CANCELLATION_NOTE: "cancellation-note",
  STOCK_TRANSFER: "stock-transfer",
} as const;

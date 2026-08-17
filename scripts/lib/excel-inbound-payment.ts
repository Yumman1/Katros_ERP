/**
 * Map Corn Summer Purchase workbook "Inbound Details" status (col K) to payment
 * storage fields used by bulk import and reconciliation scripts.
 */

export type InboundPaymentClass =
  | "FULL_RELEASE"
  | "PARTIAL_HOLD"
  | "FULL_HOLD"
  | "NO_PAYMENT";

export type ResolvedInboundPayment = {
  class: InboundPaymentClass;
  /** PKR released to seller on this truck (0 for full hold / no payment). */
  paidAmountPkr: number;
  gateInvoiceStage: "PAYMENT_APPROVED" | "PARTIAL_PAYMENT" | "HOLD_OLD_DUES" | null;
  receiptStatus: "PAID" | "PARTIALLY_PAID" | "ALLOCATED";
  holdNote: string | null;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Classify workbook status text — no DB access. */
export function classifyInboundStatus(status: string): InboundPaymentClass {
  const s = status.trim();
  const lower = s.toLowerCase();

  if (!s || lower === "no trade") return "NO_PAYMENT";
  if (/^shifting$/i.test(s) || /^fwd to sufyan$/i.test(s)) return "NO_PAYMENT";
  if (/payment release/i.test(s)) return "FULL_RELEASE";
  // User decision (plan): KCS-323 DN - Short treated as fully cleared in real life.
  if (/dn\s*-\s*short/i.test(s)) return "FULL_RELEASE";
  if (
    /hold/i.test(s) &&
    (/remain(ing)?\s+release/i.test(s) || /released/i.test(s) || /release/i.test(s))
  ) {
    return "PARTIAL_HOLD";
  }
  if (/^hold$/i.test(s)) return "FULL_HOLD";

  return "NO_PAYMENT";
}

/** Parse a hold amount in PKR from status phrases like "1M Hold", "1.1M req sufyan", "1278000 Debit note". */
export function parseHoldAmountPkr(status: string): number | null {
  const s = status.trim();

  const mM = s.match(/(\d+(?:\.\d+)?)\s*m\b/i);
  if (mM) return Math.round(parseFloat(mM[1]!) * 1_000_000);

  const mNum = s.match(/^(\d[\d,]*(?:\.\d+)?)\s+(?:dn|debit)/i);
  if (mNum) return parseFloat(mNum[1]!.replace(/,/g, ""));

  if (/^hold$/i.test(s)) return null;

  return null;
}

/** Pro-rata released share for one truck in a held invoice group. */
export function computeProRataPaid(
  amountDue: number,
  groupTotalDue: number,
  holdTotalPkr: number,
): number {
  if (groupTotalDue <= 0 || amountDue <= 0) return 0;
  const holdShare = holdTotalPkr * (amountDue / groupTotalDue);
  return round2(Math.max(0, amountDue - holdShare));
}

export type InboundExcelRow = {
  kcs: string;
  trade: string;
  status: string;
  amount: number | null;
};

/**
 * Resolve payment fields for one inbound row, optionally using sibling rows on
 * the same trade + hold phrase for pro-rata splitting.
 */
export function resolveInboundPayment(
  row: InboundExcelRow,
  siblings: InboundExcelRow[],
): ResolvedInboundPayment {
  const cls = classifyInboundStatus(row.status);
  const amountDue = row.amount ?? 0;

  if (cls === "NO_PAYMENT") {
    return {
      class: cls,
      paidAmountPkr: 0,
      gateInvoiceStage: null,
      receiptStatus: "ALLOCATED",
      holdNote: null,
    };
  }

  if (cls === "FULL_RELEASE") {
    return {
      class: cls,
      paidAmountPkr: round2(amountDue),
      gateInvoiceStage: "PAYMENT_APPROVED",
      receiptStatus: "PAID",
      holdNote: null,
    };
  }

  if (cls === "FULL_HOLD") {
    return {
      class: cls,
      paidAmountPkr: 0,
      gateInvoiceStage: "HOLD_OLD_DUES",
      receiptStatus: "ALLOCATED",
      holdNote: row.status.trim() || "Hold",
    };
  }

  // PARTIAL_HOLD — group siblings with the same normalized status on the same trade
  const normStatus = row.status.trim().toLowerCase();
  const group = siblings.filter(
    (s) => s.trade === row.trade && s.status.trim().toLowerCase() === normStatus,
  );
  const holdTotal = parseHoldAmountPkr(row.status);
  const groupTotal = group.reduce((sum, s) => sum + (s.amount ?? 0), 0);
  const paid =
    holdTotal != null && groupTotal > 0
      ? computeProRataPaid(amountDue, groupTotal, holdTotal)
      : 0;

  return {
    class: cls,
    paidAmountPkr: paid,
    gateInvoiceStage: paid > 0.005 ? "PARTIAL_PAYMENT" : "HOLD_OLD_DUES",
    receiptStatus: paid >= amountDue - 0.005 ? "PAID" : paid > 0.005 ? "PARTIALLY_PAID" : "ALLOCATED",
    holdNote: row.status.trim(),
  };
}

/** Gate invoice stages that appear on the trader buy-invoice approvals queue. */
export const TRADER_APPROVAL_STAGES = [
  "PENDING_TRADE_APPROVAL",
  "HOLD_OLD_DUES",
  "PARTIAL_PAYMENT",
] as const;

export function showsInTraderApprovals(gateInvoiceStage: string | null): boolean {
  return (
    gateInvoiceStage != null &&
    (TRADER_APPROVAL_STAGES as readonly string[]).includes(gateInvoiceStage)
  );
}

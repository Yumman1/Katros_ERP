/** Gate-invoice workflow stages (mirrors the Prisma GateInvoiceStage enum). */
export const GATE_INVOICE_STAGES = [
  "PENDING_TRADE_APPROVAL",
  "HOLD_OLD_DUES",
  "WRONG_INVOICING",
  "PAYMENT_APPROVED",
] as const;

export type GateInvoiceStage = (typeof GATE_INVOICE_STAGES)[number];

export const GATE_INVOICE_STAGE_LABELS: Record<GateInvoiceStage, string> = {
  PENDING_TRADE_APPROVAL: "Pending trade approval",
  HOLD_OLD_DUES: "Hold due to old dues",
  WRONG_INVOICING: "Wrong invoicing",
  PAYMENT_APPROVED: "Payment approved",
};

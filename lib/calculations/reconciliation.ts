export type ReconResult =
  | { status: "MATCHED" }
  | {
      status: "BREAK";
      difference: number;
      reason: "QUANTITY_MISMATCH" | "AMOUNT_MISMATCH";
    };

/** Trade vs invoice heuristic matching (tolerance-based). */
export function autoReconcileTradeInvoice(opts: {
  tradeQuantity: number;
  tradeGross: number;
  invoiceQuantity: number | null;
  invoiceAmount: number;
}): ReconResult {
  const invQty = opts.invoiceQuantity ?? opts.tradeQuantity;
  const qtyTol = Math.abs(invQty - opts.tradeQuantity) / Number(opts.tradeQuantity) < 0.001;
  const amtTol =
    Math.abs(opts.invoiceAmount - opts.tradeGross) < 100;
  if (qtyTol && amtTol) return { status: "MATCHED" };
  return {
    status: "BREAK",
    difference: opts.invoiceAmount - opts.tradeGross,
    reason: qtyTol ? "AMOUNT_MISMATCH" : "QUANTITY_MISMATCH",
  };
}

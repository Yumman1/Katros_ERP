/** Matches the supplied MTM worksheet; this price spread is not cash or booked P&L. */
export function cornInOut(openMt: number, lockedRate: number | null, todayRate: number | null) {
  if (lockedRate == null || todayRate == null) return null;
  return Math.round((lockedRate - todayRate) * openMt * 25 * 100) / 100;
}
export function cornNoteDirection(side: "BUY" | "SELL", entryType: "DEBIT" | "CREDIT") {
  return (side === "SELL" && entryType === "DEBIT") || (side === "BUY" && entryType === "CREDIT") ? "RECEIVABLE" as const : "PAYABLE" as const;
}
export function cornNoteStatus(direction: "RECEIVABLE" | "PAYABLE", settled: boolean, paid: number) {
  if (settled) return direction === "RECEIVABLE" ? "Received" : "Paid";
  if (paid > 0) return direction === "RECEIVABLE" ? "Partly received" : "Partly paid";
  return direction === "RECEIVABLE" ? "Awaiting receipt" : "Awaiting payment";
}

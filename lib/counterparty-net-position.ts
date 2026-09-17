/** Reporting projection only. Never used to authorize funding or settlement. */
export type NetPositionAccount = {
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  side: "BUY" | "SELL";
  entries: {
    entryType: "DEBIT" | "CREDIT";
    sourceType: string;
    amountPkr: number;
    billedPkr: number;
    paidPkr: number;
    noteStatus: "UNPAID" | "PAID" | null;
    settlesNoteRef: string | null;
  }[];
};

export function counterpartyNetPositions(accounts: NetPositionAccount[]) {
  const byCounterparty = new Map<string, {
    counterpartyId: string; counterpartyName: string; counterpartyCode: string;
    receivablePkr: number; payablePkr: number; netPkr: number;
  }>();
  for (const account of accounts) {
    const row = byCounterparty.get(account.counterpartyId) ?? {
      counterpartyId: account.counterpartyId, counterpartyName: account.counterpartyName,
      counterpartyCode: account.counterpartyCode, receivablePkr: 0, payablePkr: 0, netPkr: 0,
    };
    let ordinaryBalance = 0;
    for (const entry of account.entries) {
      // Note vouchers are already applied through paidPkr on their own note.
      if (entry.noteStatus === "PAID" || entry.settlesNoteRef) continue;
      if (account.side === "BUY" && entry.sourceType === "PAYMENT") continue;
      const sign = (account.side === "SELL" ? 1 : -1) * (entry.entryType === "DEBIT" ? 1 : -1);
      if (entry.noteStatus === "UNPAID") {
        const remaining = Math.max(0, entry.billedPkr - entry.paidPkr);
        if (sign > 0) row.receivablePkr += remaining;
        else row.payablePkr += remaining;
        continue;
      }
      // Purchase gate payments are stored on receipts; they have no usable
      // payment credit row. Sale/invoice payments are represented by credits.
      const amount = account.side === "BUY" && entry.sourceType === "GATEPASS" && entry.entryType === "DEBIT"
        ? entry.billedPkr - entry.paidPkr
        : entry.entryType === "DEBIT" ? entry.billedPkr : entry.amountPkr;
      ordinaryBalance += sign * amount;
    }
    row.receivablePkr += Math.max(0, ordinaryBalance);
    row.payablePkr += Math.max(0, -ordinaryBalance);
    byCounterparty.set(account.counterpartyId, row);
  }
  return [...byCounterparty.values()].map((row) => {
    const receivablePkr = Math.round(row.receivablePkr * 100) / 100;
    const payablePkr = Math.round(row.payablePkr * 100) / 100;
    return { ...row, receivablePkr, payablePkr, netPkr: Math.round((receivablePkr - payablePkr) * 100) / 100 };
  });
}

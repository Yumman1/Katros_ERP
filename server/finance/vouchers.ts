import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import { allocateSerial, SERIALS } from "@/server/db/serials";
import { listOpenSettlementNotes, markSettlementNotePaid, postCreditForVoucher } from "./ledger";

export type VoucherView = {
  id: string;
  voucherNo: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  /** Ledger account credited — SELL for a sale, BUY for a purchase settlement. */
  side: "BUY" | "SELL";
  /** Trade this payment is against; null = direct advance. */
  tradeRef: string | null;
  /** Cancellation / short-close note this voucher settles; null otherwise. */
  noteRef: string | null;
  amountPkr: number;
  method: string | null;
  reference: string | null;
  bankName: string | null;
  note: string | null;
  status: "PENDING_FINANCE" | "APPROVED" | "REJECTED";
  enteredByName: string;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  voucherDate: Date;
  createdAt: Date;
};

const VOUCHER_INCLUDE = {
  counterparty: { select: { name: true, code: true } },
} as const;

type VoucherRow = Awaited<ReturnType<typeof prisma.voucher.findMany<{ include: typeof VOUCHER_INCLUDE }>>>[number];

function voucherRowToView(row: VoucherRow): VoucherView {
  return {
    id: row.id,
    voucherNo: row.voucherNo,
    counterpartyId: row.counterpartyId,
    counterpartyName: row.counterparty.name,
    counterpartyCode: row.counterparty.code,
    side: row.side,
    tradeRef: row.tradeRef,
    noteRef: row.noteRef,
    amountPkr: num(row.amountPkr),
    method: row.method,
    reference: row.reference,
    bankName: row.bankName,
    note: row.note,
    status: row.status,
    enteredByName: row.enteredByName,
    resolvedByName: row.resolvedByName,
    resolvedAt: row.resolvedAt,
    resolutionNote: row.resolutionNote,
    voucherDate: row.voucherDate,
    createdAt: row.createdAt,
  };
}

/** Execution enters a payment voucher — pending until finance approves it. */
export async function createVoucher(input: {
  counterpartyId: string;
  /** Ledger account to credit — SELL (a sale) or BUY (a purchase settlement). */
  side?: "BUY" | "SELL";
  /** Trade the payment is against; null/undefined = direct advance. */
  tradeRef?: string | null;
  /** Cancellation / short-close note being settled — takes over from tradeRef. */
  noteRef?: string | null;
  amountPkr: number;
  method?: string | null;
  reference?: string | null;
  bankName?: string | null;
  voucherDate?: Date | null;
  note?: string | null;
  enteredByName: string;
}): Promise<VoucherView> {
  if (!Number.isFinite(input.amountPkr) || input.amountPkr <= 0) {
    throw new Error("Voucher amount must be positive");
  }
  const method = input.method?.trim() || null;
  const bankName = input.bankName?.trim() || null;
  if (method?.toLowerCase() === "bank transfer" && !bankName) {
    throw new Error("Select a bank when payment method is Bank transfer");
  }
  const cp = await prisma.counterparty.findUnique({
    where: { id: input.counterpartyId },
    select: { id: true },
  });
  if (!cp) throw new Error("Counterparty not found");
  let side = input.side ?? "SELL";
  let tradeRef = input.tradeRef?.trim() || null;
  const noteRef = input.noteRef?.trim() || null;

  if (noteRef) {
    // A note voucher pays a cancellation claim, not a delivery. The note itself
    // dictates the account and the trade — the operator only confirms the money
    // moved — and it settles in one go, so the amount must match what is due.
    const open = await listOpenSettlementNotes(input.counterpartyId);
    const note = open.find((n) => n.noteRef === noteRef);
    if (!note) {
      throw new Error(`${noteRef} is not an open note on this counterparty`);
    }
    if (Math.abs(note.amountPkr - input.amountPkr) > 0.5) {
      throw new Error(
        `${noteRef} is due ${note.amountPkr.toLocaleString("en-PK")} PKR — a note is settled in full, not in parts`,
      );
    }
    side = note.side;
    tradeRef = note.tradeRef;
  } else if (tradeRef) {
    const trade = await prisma.trade.findUnique({
      where: { tradeRef },
      select: {
        counterpartyId: true,
        direction: true,
        directSettled: true,
        settlementClosedAt: true,
      },
    });
    if (!trade) throw new Error("Trade not found: " + tradeRef);
    if (trade.counterpartyId !== input.counterpartyId) {
      throw new Error(`${tradeRef} does not belong to this counterparty`);
    }
    // A settled trade is collected on the account matching its direction, so
    // the voucher credit meets the settlement invoice's debit.
    if (trade.directSettled) {
      if (trade.settlementClosedAt) {
        throw new Error(
          `${tradeRef} is settled and closed — its full trade amount is already in the ledger`,
        );
      }
      const want = trade.direction === "BUY" ? "BUY" : "SELL";
      if (side !== want) {
        throw new Error(
          `${tradeRef} is a ${trade.direction} trade — record it as a ${want === "BUY" ? "purchase" : "sale"} so it credits the ${want.toLowerCase()} ledger`,
        );
      }
    } else if (trade.direction !== "SELL") {
      throw new Error(
        "Vouchers can only be linked to SELL trades (money coming in) or to settled trades",
      );
    } else if (side !== "SELL") {
      throw new Error(`${tradeRef} is a sale — record it as a sale so it credits the sell ledger`);
    }
  } else if (side !== "SELL") {
    // A direct advance funds a buyer's future trucks, which only exists on the
    // sell side; a purchase voucher must name the settled trade it pays.
    throw new Error("A purchase voucher must be recorded against a settled purchase trade");
  }
  const row = await allocateSerial(SERIALS.VOUCHER, (voucherNo) =>
    prisma.voucher.create({
      data: {
        voucherNo,
        counterpartyId: input.counterpartyId,
        side,
        tradeRef,
        noteRef,
        amountPkr: input.amountPkr,
        method,
        reference: input.reference?.trim() || null,
        bankName,
        voucherDate: input.voucherDate ?? new Date(),
        note: input.note?.trim() || null,
        enteredByName: input.enteredByName,
      },
      include: VOUCHER_INCLUDE,
    }),
  );
  return voucherRowToView(row);
}

export async function listVouchers(filter?: {
  status?: "PENDING_FINANCE" | "APPROVED" | "REJECTED";
  counterpartyId?: string;
}): Promise<VoucherView[]> {
  const rows = await prisma.voucher.findMany({
    where: {
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.counterpartyId ? { counterpartyId: filter.counterpartyId } : {}),
    },
    include: VOUCHER_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(voucherRowToView);
}

/**
 * Finance approves a voucher — only then does the money become part of the
 * counterparty's ledger (CREDIT entry), which in turn unlocks outbound trucks
 * awaiting balance.
 */
export async function approveVoucher(
  voucherId: string,
  approvedByName: string,
  note?: string,
): Promise<VoucherView> {
  // Status flip + ledger credit are ONE transaction — an approved voucher can
  // never exist without its credit (and vice versa).
  await prisma.$transaction(async (tx) => {
    const updated = await tx.voucher.updateMany({
      where: { id: voucherId, status: "PENDING_FINANCE" },
      data: {
        status: "APPROVED",
        resolvedByName: approvedByName,
        resolvedAt: new Date(),
        resolutionNote: note?.trim() || null,
      },
    });
    if (updated.count === 0) {
      throw new Error("Voucher not found or already resolved");
    }
    const row = await tx.voucher.findUnique({ where: { id: voucherId } });
    await postCreditForVoucher(
      {
        voucherId: row!.id,
        voucherNo: row!.voucherNo,
        counterpartyId: row!.counterpartyId,
        amountPkr: num(row!.amountPkr),
        side: row!.side,
        tradeRef: row!.tradeRef,
        note: row!.noteRef
          ? `Settles ${row!.noteRef}${row!.note ? ` — ${row!.note}` : ""}`
          : row!.note,
      },
      tx,
    );
    // Closing the claim rides in the same transaction as its credit — a note can
    // never read as paid without the money, nor the money land without closing it.
    if (row!.noteRef) {
      await markSettlementNotePaid(
        {
          counterpartyId: row!.counterpartyId,
          noteRef: row!.noteRef,
          voucherNo: row!.voucherNo,
        },
        tx,
      );
    }
  });
  const fresh = await prisma.voucher.findUnique({
    where: { id: voucherId },
    include: VOUCHER_INCLUDE,
  });
  // The credit just landed — if it completes a settled trade's amount, that
  // trade closes now. A note voucher is exempt: its trade is already cancelled
  // or closed, and its money answers to the note, not to a settlement invoice.
  if (fresh?.tradeRef && !fresh.noteRef) {
    const { syncSettlementCollection } = await import("@/server/settlement-billing");
    await syncSettlementCollection(fresh.tradeRef, approvedByName);
  }
  return voucherRowToView(fresh!);
}

export async function rejectVoucher(
  voucherId: string,
  rejectedByName: string,
  note?: string,
): Promise<VoucherView> {
  const reason = note?.trim();
  if (!reason) throw new Error("A rejection reason is required");
  const updated = await prisma.voucher.updateMany({
    where: { id: voucherId, status: "PENDING_FINANCE" },
    data: {
      status: "REJECTED",
      resolvedByName: rejectedByName,
      resolvedAt: new Date(),
      resolutionNote: reason,
    },
  });
  if (updated.count === 0) {
    throw new Error("Voucher not found or already resolved");
  }
  const row = await prisma.voucher.findUnique({
    where: { id: voucherId },
    include: VOUCHER_INCLUDE,
  });
  const { recordRejection } = await import("@/server/rejections");
  await recordRejection({
    kind: "VOUCHER",
    refLabel: row!.voucherNo,
    voucherNo: row!.voucherNo,
    counterpartyName: row!.counterparty.name,
    amountPkr: num(row!.amountPkr),
    rejectedBy: rejectedByName,
    rejectedRole: "FINANCE",
    reason,
  });
  return voucherRowToView(row!);
}

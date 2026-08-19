import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import { allocateSerial, SERIALS } from "@/server/db/serials";
import {
  listOpenSettlementNotes,
  markSettlementNotePaid,
  noteBalance,
  noteShouldClose,
  postCreditForVoucher,
} from "./ledger";

export type VoucherView = {
  id: string;
  voucherNo: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyCode: string;
  /** Ledger account credited — SELL for a sale, BUY for a purchase settlement. */
  side: "BUY" | "SELL";
  /** Trade reference for reconciliation; null = no trade tagged. */
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

/** Normalize bank for duplicate detection (empty when not a bank transfer). */
export function normalizeVoucherBankKey(bankName: string | null | undefined): string {
  return (bankName?.trim() ?? "").toLowerCase();
}

export function normalizeVoucherReference(reference: string): string {
  return reference.trim().toLowerCase();
}

/** Calendar day (UTC) for voucher-date matching. */
export function voucherDateCalendarKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function vouchersSharePaymentKey(
  a: {
    bankName: string | null | undefined;
    reference: string | null | undefined;
    voucherDate: Date;
    amountPkr: number | string | { toString(): string };
  },
  b: {
    bankName: string | null | undefined;
    reference: string | null | undefined;
    voucherDate: Date;
    amountPkr: number | string | { toString(): string };
  },
): boolean {
  if (normalizeVoucherReference(a.reference ?? "") !== normalizeVoucherReference(b.reference ?? "")) {
    return false;
  }
  if (normalizeVoucherBankKey(a.bankName) !== normalizeVoucherBankKey(b.bankName)) {
    return false;
  }
  if (voucherDateCalendarKey(a.voucherDate) !== voucherDateCalendarKey(b.voucherDate)) {
    return false;
  }
  return Math.abs(Number(a.amountPkr) - Number(b.amountPkr)) < 0.005;
}

/**
 * Another pending or approved voucher with the same bank + reference + date +
 * amount — blocks double entry of the same payment slip.
 */
export async function findDuplicateVoucher(input: {
  bankName: string | null;
  reference: string;
  voucherDate: Date;
  amountPkr: number;
}): Promise<{ voucherNo: string; status: string } | null> {
  const dayStart = new Date(input.voucherDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(input.voucherDate);
  dayEnd.setUTCHours(23, 59, 59, 999);

  const candidates = await prisma.voucher.findMany({
    where: {
      status: { in: ["PENDING_FINANCE", "APPROVED"] },
      voucherDate: { gte: dayStart, lte: dayEnd },
    },
    select: {
      voucherNo: true,
      status: true,
      bankName: true,
      reference: true,
      voucherDate: true,
      amountPkr: true,
    },
  });

  const probe = {
    bankName: input.bankName,
    reference: input.reference,
    voucherDate: input.voucherDate,
    amountPkr: input.amountPkr,
  };

  const dup = candidates.find((v) => vouchersSharePaymentKey(probe, v));
  return dup ? { voucherNo: dup.voucherNo, status: dup.status } : null;
}

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
  /** Trade reference for reconciliation; null/undefined = no trade tagged. */
  tradeRef?: string | null;
  /** Cancellation / short-close note being settled — takes over from tradeRef. */
  noteRef?: string | null;
  amountPkr: number;
  method?: string | null;
  /** Bank slip, cheque, or transfer reference — required on every voucher. */
  reference?: string | null;
  bankName?: string | null;
  voucherDate?: Date | null;
  note?: string | null;
  enteredByName: string;
}): Promise<VoucherView> {
  if (!Number.isFinite(input.amountPkr) || input.amountPkr <= 0) {
    throw new Error("Voucher amount must be positive");
  }
  const reference = input.reference?.trim() || null;
  if (!reference) {
    throw new Error("Payment reference is required (slip, cheque, or transfer reference number)");
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
    // A note voucher pays a cancellation claim in one or more pieces. The note
    // dictates the account and trade; each approved voucher posts to the ledger.
    const open = await listOpenSettlementNotes(input.counterpartyId);
    const note = open.find((n) => n.noteRef === noteRef);
    if (!note) {
      throw new Error(`${noteRef} is not an open note on this counterparty`);
    }
    if (input.amountPkr > note.remainingPkr + 0.005) {
      throw new Error(
        `${noteRef} has ${note.remainingPkr.toLocaleString("en-PK")} PKR remaining of ${note.billedPkr.toLocaleString("en-PK")} PKR — voucher exceeds what is due`,
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
    // Sale vouchers without a trade ref still join the buyer's shared pool; purchase
    // vouchers must name the settled trade they pay.
    throw new Error("A purchase voucher must be recorded against a settled purchase trade");
  }

  const voucherDate = input.voucherDate ?? new Date();
  const duplicate = await findDuplicateVoucher({
    bankName,
    reference,
    voucherDate,
    amountPkr: input.amountPkr,
  });
  if (duplicate) {
    throw new Error(
      `This payment is already recorded as ${duplicate.voucherNo} (${duplicate.status === "APPROVED" ? "approved" : "pending finance"}) — same bank, reference, date, and amount`,
    );
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
        reference,
        bankName,
        voucherDate,
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
    // Close the note only once the internal sub-ledger is within tolerance.
    if (row!.noteRef) {
      const { remainingPkr } = await noteBalance(row!.noteRef, row!.counterpartyId, tx);
      if (noteShouldClose(remainingPkr)) {
        await markSettlementNotePaid(
          {
            counterpartyId: row!.counterpartyId,
            noteRef: row!.noteRef,
            voucherNo: row!.voucherNo,
          },
          tx,
        );
      }
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

import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import { COUNTER, nextRef } from "@/server/db/counters";
import { postCreditForVoucher } from "./ledger";

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
  amountPkr: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  status: "PENDING_FINANCE" | "APPROVED" | "REJECTED";
  enteredByName: string;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
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
    amountPkr: num(row.amountPkr),
    method: row.method,
    reference: row.reference,
    note: row.note,
    status: row.status,
    enteredByName: row.enteredByName,
    resolvedByName: row.resolvedByName,
    resolvedAt: row.resolvedAt,
    resolutionNote: row.resolutionNote,
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
  amountPkr: number;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  enteredByName: string;
}): Promise<VoucherView> {
  if (!Number.isFinite(input.amountPkr) || input.amountPkr <= 0) {
    throw new Error("Voucher amount must be positive");
  }
  const cp = await prisma.counterparty.findUnique({
    where: { id: input.counterpartyId },
    select: { id: true },
  });
  if (!cp) throw new Error("Counterparty not found");
  const side = input.side ?? "SELL";
  const tradeRef = input.tradeRef?.trim() || null;
  if (tradeRef) {
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
  const seq = await nextRef(COUNTER.VOUCHER);
  const row = await prisma.voucher.create({
    data: {
      voucherNo: `VCH-${String(seq).padStart(5, "0")}`,
      counterpartyId: input.counterpartyId,
      side,
      tradeRef,
      amountPkr: input.amountPkr,
      method: input.method?.trim() || null,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      enteredByName: input.enteredByName,
    },
    include: VOUCHER_INCLUDE,
  });
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
        note: row!.note,
      },
      tx,
    );
  });
  const fresh = await prisma.voucher.findUnique({
    where: { id: voucherId },
    include: VOUCHER_INCLUDE,
  });
  // The credit just landed — if it completes a settled trade's amount, that
  // trade closes now.
  if (fresh?.tradeRef) {
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

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
  const seq = await nextRef(COUNTER.VOUCHER);
  const row = await prisma.voucher.create({
    data: {
      voucherNo: `VCH-${String(seq).padStart(5, "0")}`,
      counterpartyId: input.counterpartyId,
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
  const updated = await prisma.voucher.updateMany({
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
  const row = await prisma.voucher.findUnique({
    where: { id: voucherId },
    include: VOUCHER_INCLUDE,
  });
  await postCreditForVoucher({
    voucherId: row!.id,
    voucherNo: row!.voucherNo,
    counterpartyId: row!.counterpartyId,
    amountPkr: num(row!.amountPkr),
    note: row!.note,
  });
  return voucherRowToView(row!);
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

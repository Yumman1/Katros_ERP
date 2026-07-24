import type { Prisma } from "@prisma/client";
import { KG_PER_MAUND, type ExecutionProfile } from "@/lib/trade-constants";
import { prisma } from "@/server/db";
import { num } from "@/server/db/convert";
import { COUNTER, nextRef } from "@/server/db/counters";
import {
  SPOT_INCLUDE,
  inboundRowToRuntime,
  paymentRowToRuntime,
  spotRowToRuntime,
  type InboundReceipt,
  type PaymentRequest,
  type PaymentRequestStatus,
  type SpotPurchaseEvent,
  type SpotPurchaseState,
} from "./runtime";
import { refreshContract } from "./contracts";

export async function getSpotEvent(tradeRef: string): Promise<SpotPurchaseEvent | null> {
  const row = await prisma.spotPurchaseEvent.findUnique({
    where: { tradeRef },
    include: SPOT_INCLUDE,
  });
  return row ? spotRowToRuntime(row) : null;
}

/** Spot pipeline rows for a profile (open contracts + current spot state). */
export async function listSpotPipeline(profile: ExecutionProfile = "PURCHASE_SPOT") {
  const contracts = await prisma.executionContract.findMany({
    where: { executionProfile: profile },
    select: { tradeRef: true },
    orderBy: { lockedAt: "desc" },
  });
  const refs = contracts.map((c) => c.tradeRef);
  const events = refs.length
    ? await prisma.spotPurchaseEvent.findMany({ where: { tradeRef: { in: refs } } })
    : [];
  const eventByRef = new Map(events.map((e) => [e.tradeRef, e]));
  return contracts.map((c) => {
    const ev = eventByRef.get(c.tradeRef);
    return {
      tradeRef: c.tradeRef,
      state: (ev?.state ?? "CONTRACT") as SpotPurchaseState,
      brokerName: ev?.brokerName ?? null,
      truckNo: ev?.truckNo ?? null,
    };
  });
}

/** Map a runtime patch onto spot-event columns (id/tradeRef/state/payment link are managed here). */
function spotPatchToColumns(patch?: Partial<SpotPurchaseEvent>) {
  const data: Prisma.SpotPurchaseEventUpdateInput = {};
  if (!patch) return data;
  if (patch.selectorNotes !== undefined) data.selectorNotes = patch.selectorNotes;
  if (patch.brokerName !== undefined) data.brokerName = patch.brokerName;
  if (patch.dcNo !== undefined) data.dcNo = patch.dcNo;
  if (patch.truckNo !== undefined) data.truckNo = patch.truckNo;
  if (patch.spotWeightKg !== undefined) data.spotWeightKg = patch.spotWeightKg;
  if (patch.brokerInvoiceRef !== undefined) data.brokerInvoiceRef = patch.brokerInvoiceRef;
  if (patch.invoiceAmount !== undefined) data.invoiceAmount = patch.invoiceAmount;
  if (patch.warehouseReceiveWeightKg !== undefined)
    data.warehouseReceiveWeightKg = patch.warehouseReceiveWeightKg;
  if (patch.weightVarianceKg !== undefined) data.weightVarianceKg = patch.weightVarianceKg;
  return data;
}

export async function advanceSpotState(
  tradeRef: string,
  next: SpotPurchaseState,
  patch?: Partial<SpotPurchaseEvent>,
): Promise<SpotPurchaseEvent> {
  const data = spotPatchToColumns(patch);
  let row = await prisma.spotPurchaseEvent.upsert({
    where: { tradeRef },
    update: { ...data, state: next },
    create: {
      tradeRef,
      state: next,
      selectorNotes: patch?.selectorNotes ?? null,
      brokerName: patch?.brokerName ?? null,
      dcNo: patch?.dcNo ?? null,
      truckNo: patch?.truckNo ?? null,
      spotWeightKg: patch?.spotWeightKg ?? null,
      brokerInvoiceRef: patch?.brokerInvoiceRef ?? null,
      invoiceAmount: patch?.invoiceAmount ?? null,
      warehouseReceiveWeightKg: patch?.warehouseReceiveWeightKg ?? null,
      weightVarianceKg: patch?.weightVarianceKg ?? null,
    },
    include: SPOT_INCLUDE,
  });
  if (next === "RECEIVED" && row.warehouseReceiveWeightKg != null && row.spotWeightKg != null) {
    row = await prisma.spotPurchaseEvent.update({
      where: { tradeRef },
      data: { weightVarianceKg: num(row.warehouseReceiveWeightKg) - num(row.spotWeightKg) },
      include: SPOT_INCLUDE,
    });
    await refreshContract(tradeRef);
  }
  return spotRowToRuntime(row);
}

export async function submitSpotForFinance(tradeRef: string) {
  return prisma.$transaction(async (tx) => {
    const ev = await tx.spotPurchaseEvent.findUnique({ where: { tradeRef } });
    if (!ev) throw new Error("Spot event not found");
    const contract = await tx.executionContract.findUnique({ where: { tradeRef } });
    if (!contract) throw new Error("Contract not found");
    // Finance is only ever asked to pay a REAL invoice — no fallback math.
    if (ev.invoiceAmount == null || num(ev.invoiceAmount) <= 0) {
      throw new Error(
        "Enter the broker invoice amount on the spot pipeline before submitting to finance",
      );
    }
    const dupe = await tx.paymentRequest.findFirst({
      where: { sourceType: "SPOT", sourceId: ev.id, status: "PENDING" },
      select: { id: true },
    });
    if (dupe) throw new Error("A payment request for this spot trade is already awaiting finance");
    const amount = num(ev.invoiceAmount);
    const seq = await nextRef(COUNTER.PAYMENT, tx);
    const pr = await tx.paymentRequest.create({
      data: {
        requestRef: `pay-${seq}`,
        sourceType: "SPOT",
        sourceId: ev.id,
        tradeRef,
        counterpartyName: contract.counterpartyName,
        amount,
        currency: contract.currency,
        status: "PENDING",
      },
    });
    const spot = await tx.spotPurchaseEvent.update({
      where: { tradeRef },
      data: { paymentRequestId: pr.id, state: "FINANCE_PENDING" },
      include: SPOT_INCLUDE,
    });
    return { spot: spotRowToRuntime(spot), paymentRequest: paymentRowToRuntime(pr) };
  });
}

export async function listPaymentRequests(
  status?: PaymentRequestStatus,
): Promise<PaymentRequest[]> {
  const rows = await prisma.paymentRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(paymentRowToRuntime);
}

export async function approvePayment(
  paymentId: string,
  approvedBy: string,
  comment?: string,
): Promise<PaymentRequest> {
  return prisma.$transaction(async (tx) => {
    const pr = await tx.paymentRequest.findUnique({ where: { requestRef: paymentId } });
    if (!pr) throw new Error("Payment request not found");
    // Guarded transition — only PENDING requests can be approved.
    const updated = await tx.paymentRequest.updateMany({
      where: { requestRef: paymentId, status: "PENDING" },
      data: {
        status: "APPROVED",
        approvedBy,
        approvedAt: new Date(),
        financeComment: comment ?? null,
      },
    });
    if (updated.count === 0) throw new Error(`Cannot approve status ${pr.status}`);

    if (pr.sourceType === "INBOUND") {
      await tx.inboundReceipt.updateMany({
        where: { id: pr.sourceId },
        data: { status: "PAID" },
      });
    } else if (pr.sourceType === "OUTBOUND") {
      /* stays FINANCE_PENDING until releaseOutbound */
    } else if (pr.sourceType === "SPOT") {
      await tx.spotPurchaseEvent.updateMany({
        where: { id: pr.sourceId },
        data: { state: "PAID" },
      });
    }

    // Buy-side ledger: money paid out to a seller credits their payables
    // account (the expected-invoice debit was posted at truck assignment).
    if (pr.sourceType === "INBOUND" || pr.sourceType === "SPOT") {
      const trade = await tx.trade.findUnique({
        where: { tradeRef: pr.tradeRef },
        select: { counterpartyId: true },
      });
      if (trade) {
        const { postPaymentOutCredit } = await import("@/server/finance/ledger");
        await postPaymentOutCredit(
          {
            requestRef: pr.requestRef,
            counterpartyId: trade.counterpartyId,
            amountPkr: num(pr.amount),
            tradeRef: pr.tradeRef,
            note: `Payment ${pr.requestRef} approved by ${approvedBy}`,
          },
          tx,
        );
      }
    }

    const fresh = await tx.paymentRequest.findUnique({ where: { requestRef: paymentId } });
    return paymentRowToRuntime(fresh!);
  });
}

export async function rejectPayment(
  paymentId: string,
  comment?: string,
  rejectedBy?: { name: string; role: string },
): Promise<PaymentRequest> {
  const reason = comment?.trim();
  if (!reason) throw new Error("A rejection reason is required");
  const result = await prisma.$transaction(async (tx) => {
    const pr = await tx.paymentRequest.findUnique({ where: { requestRef: paymentId } });
    if (!pr) throw new Error("Payment request not found");
    await tx.paymentRequest.update({
      where: { requestRef: paymentId },
      data: { status: "REJECTED", financeComment: reason },
    });
    if (pr.sourceType === "INBOUND") {
      await tx.inboundReceipt.updateMany({
        where: { id: pr.sourceId, status: "FINANCE_PENDING" },
        data: { status: "ALLOCATED" },
      });
    } else if (pr.sourceType === "OUTBOUND") {
      await tx.outboundDispatch.updateMany({
        where: { id: pr.sourceId, status: "FINANCE_PENDING" },
        data: { status: "WEIGHED" },
      });
    } else if (pr.sourceType === "SPOT") {
      await tx.spotPurchaseEvent.updateMany({
        where: { id: pr.sourceId, state: "FINANCE_PENDING" },
        data: { state: "INVOICED" },
      });
    }
    const fresh = await tx.paymentRequest.findUnique({ where: { requestRef: paymentId } });
    return paymentRowToRuntime(fresh!);
  });

  // Rejections page record — every portal sees who bounced it and why.
  {
    const { recordRejection } = await import("@/server/rejections");
    const trade = await prisma.trade.findUnique({
      where: { tradeRef: result.tradeRef },
      select: { traderName: true },
    });
    await recordRejection({
      kind: "PAYMENT",
      refLabel: result.id,
      tradeRef: result.tradeRef,
      counterpartyName: result.counterpartyName,
      amountPkr: result.amount,
      traderName: trade?.traderName ?? null,
      rejectedBy: rejectedBy?.name ?? "finance",
      rejectedRole: rejectedBy?.role ?? "FINANCE",
      reason,
    });
  }
  return result;
}

/**
 * Delete an erroneous payment request AND unwind its source back to a
 * re-submittable state so the receipt/spot never strands in "awaiting
 * finance" with no pending request.
 */
export async function deletePaymentRequest(id: string): Promise<{ ok: true }> {
  const pr = await prisma.paymentRequest.findUnique({ where: { requestRef: id } });
  if (!pr) throw new Error("Payment request not found");
  if (pr.status === "APPROVED") {
    throw new Error("Approved payments cannot be deleted — money has already moved");
  }
  await prisma.$transaction(async (tx) => {
    if (pr.sourceType === "INBOUND") {
      await tx.inboundReceipt.updateMany({
        where: { id: pr.sourceId, status: "FINANCE_PENDING" },
        data: { status: "ALLOCATED", paymentRequestId: null },
      });
    } else if (pr.sourceType === "OUTBOUND") {
      await tx.outboundDispatch.updateMany({
        where: { id: pr.sourceId, status: "FINANCE_PENDING" },
        data: { status: "WEIGHED", paymentRequestId: null },
      });
    } else if (pr.sourceType === "SPOT") {
      await tx.spotPurchaseEvent.updateMany({
        where: { id: pr.sourceId, state: "FINANCE_PENDING" },
        data: { state: "INVOICED", paymentRequestId: null },
      });
    }
    await tx.paymentRequest.delete({ where: { requestRef: id } });
  });
  return { ok: true };
}

export async function markInboundPaidAfterApproval(receiptId: string): Promise<InboundReceipt> {
  const r = await prisma.inboundReceipt.findUnique({
    where: { id: receiptId },
    include: { paymentRequest: true },
  });
  if (!r?.paymentRequestId) throw new Error("No payment linked");
  if (r.paymentRequest?.status !== "APPROVED") throw new Error("Payment not approved");
  const updated = await prisma.inboundReceipt.update({
    where: { id: receiptId },
    data: { status: "PAID" },
    include: { paymentRequest: { select: { requestRef: true } } },
  });
  await refreshContract(updated.tradeRef);
  return inboundRowToRuntime(updated);
}

export async function getPaymentRequests(filter?: { status?: string }): Promise<PaymentRequest[]> {
  const rows = await prisma.paymentRequest.findMany({ orderBy: { createdAt: "desc" } });
  const all = rows.map(paymentRowToRuntime);
  if (filter?.status) return all.filter((p) => p.status === filter.status);
  return all;
}

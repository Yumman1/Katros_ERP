import { KG_PER_MAUND, type ExecutionProfile } from "@/lib/trade-constants";
import {
  type PaymentRequest,
  type PaymentRequestStatus,
  type SpotPurchaseEvent,
  type SpotPurchaseState,
  ex,
  getExecutionRuntime,
  persistExecutionState,
  syncExecutionFromDisk,
} from "./runtime";
import { getContractByRef, refreshContract } from "./contracts";

export function getSpotEvent(tradeRef: string) {
  return ex().spotEvents.get(tradeRef) ?? null;
}

/** Spot pipeline rows for a profile (open contracts + current spot state). */
export function listSpotPipeline(profile: ExecutionProfile = "PURCHASE_SPOT") {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  return [...rt.contracts.values()]
    .filter((c) => c.executionProfile === profile)
    .map((c) => {
      const ev = rt.spotEvents.get(c.tradeRef);
      return {
        tradeRef: c.tradeRef,
        state: ev?.state ?? ("CONTRACT" as SpotPurchaseState),
        brokerName: ev?.brokerName ?? null,
        truckNo: ev?.truckNo ?? null,
      };
    });
}

export function advanceSpotState(
  tradeRef: string,
  next: SpotPurchaseState,
  patch?: Partial<SpotPurchaseEvent>,
) {
  const rt = ex();
  let ev = rt.spotEvents.get(tradeRef);
  if (!ev) {
    ev = {
      id: `spot-${tradeRef}`,
      tradeRef,
      state: "CONTRACT",
      selectorNotes: null,
      brokerName: null,
      dcNo: null,
      truckNo: null,
      spotWeightKg: null,
      brokerInvoiceRef: null,
      invoiceAmount: null,
      warehouseReceiveWeightKg: null,
      weightVarianceKg: null,
      paymentRequestId: null,
    };
    rt.spotEvents.set(tradeRef, ev);
  }
  Object.assign(ev, patch, { state: next });
  if (next === "RECEIVED" && ev.warehouseReceiveWeightKg != null && ev.spotWeightKg != null) {
    ev.weightVarianceKg = ev.warehouseReceiveWeightKg - ev.spotWeightKg;
    refreshContract(tradeRef);
  }
  persistExecutionState();
  return ev;
}

export function submitSpotForFinance(tradeRef: string) {
  const rt = ex();
  const ev = rt.spotEvents.get(tradeRef);
  if (!ev) throw new Error("Spot event not found");
  const contract = getContractByRef(tradeRef);
  if (!contract) throw new Error("Contract not found");
  const amount = ev.invoiceAmount ?? contract.contractualQtyMt * (contract.ratePerMaund ?? 0) * KG_PER_MAUND;
  rt.paymentSeq += 1;
  const pr: PaymentRequest = {
    id: `pay-${rt.paymentSeq}`,
    sourceType: "SPOT",
    sourceId: ev.id,
    tradeRef,
    counterpartyName: contract.counterpartyName,
    amount,
    currency: contract.currency,
    status: "PENDING",
    financeComment: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: new Date(),
  };
  rt.paymentRequests.push(pr);
  ev.paymentRequestId = pr.id;
  ev.state = "FINANCE_PENDING";
  persistExecutionState();
  return { spot: ev, paymentRequest: pr };
}

export function listPaymentRequests(status?: PaymentRequestStatus) {
  const rt = ex();
  return status ? rt.paymentRequests.filter((p) => p.status === status) : [...rt.paymentRequests];
}

export function approvePayment(paymentId: string, approvedBy: string, comment?: string) {
  const rt = ex();
  const pr = rt.paymentRequests.find((p) => p.id === paymentId);
  if (!pr) throw new Error("Payment request not found");
  if (pr.status !== "PENDING") throw new Error(`Cannot approve status ${pr.status}`);
  pr.status = "APPROVED";
  pr.approvedBy = approvedBy;
  pr.approvedAt = new Date();
  pr.financeComment = comment ?? null;

  if (pr.sourceType === "INBOUND") {
    const r = rt.inboundReceipts.find((x) => x.id === pr.sourceId);
    if (r) r.status = "PAID";
  } else if (pr.sourceType === "OUTBOUND") {
    const d = rt.outboundDispatches.find((x) => x.id === pr.sourceId);
    if (d && d.status === "FINANCE_PENDING") {
      /* stays FINANCE_PENDING until releaseOutbound */
    }
  } else if (pr.sourceType === "SPOT") {
    const ev = [...rt.spotEvents.values()].find((e) => e.id === pr.sourceId);
    if (ev) ev.state = "PAID";
  }
  persistExecutionState();
  return pr;
}

export function rejectPayment(paymentId: string, comment?: string) {
  const rt = ex();
  const pr = rt.paymentRequests.find((p) => p.id === paymentId);
  if (!pr) throw new Error("Payment request not found");
  pr.status = "REJECTED";
  pr.financeComment = comment ?? null;
  if (pr.sourceType === "INBOUND") {
    const r = rt.inboundReceipts.find((x) => x.id === pr.sourceId);
    if (r && r.status === "FINANCE_PENDING") r.status = "ALLOCATED";
  } else if (pr.sourceType === "OUTBOUND") {
    const d = rt.outboundDispatches.find((x) => x.id === pr.sourceId);
    if (d && d.status === "FINANCE_PENDING") d.status = "WEIGHED";
  } else if (pr.sourceType === "SPOT") {
    const ev = [...rt.spotEvents.values()].find((e) => e.id === pr.sourceId);
    if (ev && ev.state === "FINANCE_PENDING") ev.state = "INVOICED";
  }
  persistExecutionState();
  return pr;
}

export function deletePaymentRequest(id: string): { ok: true } {
  syncExecutionFromDisk();
  const rt = getExecutionRuntime();
  const before = rt.paymentRequests.length;
  rt.paymentRequests = rt.paymentRequests.filter((p) => p.id !== id);
  if (rt.paymentRequests.length === before) throw new Error("Payment request not found");
  persistExecutionState();
  return { ok: true };
}

export function markInboundPaidAfterApproval(receiptId: string) {
  const rt = ex();
  const r = rt.inboundReceipts.find((x) => x.id === receiptId);
  if (!r?.paymentRequestId) throw new Error("No payment linked");
  const pr = rt.paymentRequests.find((p) => p.id === r.paymentRequestId);
  if (pr?.status !== "APPROVED") throw new Error("Payment not approved");
  r.status = "PAID";
  refreshContract(r.tradeRef);
  persistExecutionState();
  return r;
}

export function getPaymentRequests(filter?: { status?: string }) {
  const rt = ex();
  const all = [...rt.paymentRequests].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (filter?.status) return all.filter((p) => p.status === filter.status);
  return all;
}

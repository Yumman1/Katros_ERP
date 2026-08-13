"use client";

import { useState } from "react";
import { AlertTriangle, MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";
import Link from "next/link";
import { invalidateApprovalCaches, invalidateGateOpsCaches } from "@/lib/invalidate-caches";
import { formatCurrency, formatQtyWithUnit } from "@/lib/formatters/numbers";
import { GATE_INVOICE_STAGE_LABELS, type GateInvoiceStage } from "@/lib/gate-invoice";
import { trpc } from "@/lib/trpc/client";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment, type ChangeRequestAction } from "@/lib/departments";

export type GateRegisterEntry =
  | {
      kind: "pending";
      id: string;
      gatepassNo: string;
      truckNo: string;
      movementType: "INBOUND" | "OUTBOUND";
      warehouseName: string;
      counterpartyName: string;
      transporterName?: string | null;
      transporterPhone?: string | null;
      builtyDetails?: string | null;
      commodityCode?: string | null;
      commodityName?: string | null;
      quantityAsPerBuilty?: string | null;
      weightAsPerBuiltyKg?: number | null;
      weighBridgeName?: string | null;
      warehouseWeightKg?: number | null;
      quantityBagsBales?: number | null;
      totalDeductionsKg?: number | null;
      weightKg: number;
      bags?: number | null;
      remarks?: string | null;
      status: string;
      generatedAt: Date | string;
      gateInvoiceNo?: string | null;
      gateInvoiceWeightKg?: number | null;
      gateInvoiceQtyMt?: number | null;
      gateInvoiceAmount?: number | null;
      gateInvoiceCurrency?: string | null;
      gateInvoiceTradeRef?: string | null;
      gateInvoiceStage?: GateInvoiceStage | null;
    }
  | {
      kind: "inbound";
      id: string;
      gatepassNo: string;
      truckNo: string;
      tradeRef: string;
      warehouseName: string;
      counterpartyName: string;
      weightKg: number;
      bags?: number | null;
      driverName?: string | null;
      driverPhone?: string | null;
      builtyDetails?: string | null;
      remarks?: string | null;
      generatedAt: Date | string;
      gateInvoiceNo?: string | null;
      gateInvoiceQtyMt?: number | null;
      gateInvoiceAmount?: number | null;
      gateInvoiceCurrency?: string | null;
    }
  | {
      kind: "outbound";
      id: string;
      gatepassNo: string;
      truckNo: string;
      tradeRef: string;
      warehouseName: string;
      counterpartyName: string;
      weightKg: number;
      driverName?: string | null;
      driverPhone?: string | null;
      doRef?: string | null;
      remarks?: string | null;
      generatedAt: Date | string;
    };

function fmtGeneratedAt(d: Date | string) {
  return new Date(d).toLocaleString("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type EditForm = {
  truckNo: string;
  weightKg: string;
  weightAsPerBuiltyKg: string;
  bags: string;
  quantityBagsBales: string;
  warehouseName: string;
  counterpartyName: string;
  transporterName: string;
  transporterPhone: string;
  builtyDetails: string;
  quantityAsPerBuilty: string;
  weighBridgeName: string;
  warehouseWeightKg: string;
  totalDeductionsKg: string;
  remarks: string;
};

function entryToForm(entry: GateRegisterEntry): EditForm {
  if (entry.kind === "pending") {
    return {
      truckNo: entry.truckNo,
      weightKg: String(entry.weightKg),
      weightAsPerBuiltyKg:
        entry.weightAsPerBuiltyKg != null ? String(entry.weightAsPerBuiltyKg) : String(entry.weightKg),
      bags: entry.bags != null ? String(entry.bags) : "",
      quantityBagsBales:
        entry.quantityBagsBales != null ? String(entry.quantityBagsBales) : entry.bags != null ? String(entry.bags) : "",
      warehouseName: entry.warehouseName,
      counterpartyName: entry.counterpartyName,
      transporterName: entry.transporterName ?? "",
      transporterPhone: entry.transporterPhone ?? "",
      builtyDetails: entry.builtyDetails ?? "",
      quantityAsPerBuilty: entry.quantityAsPerBuilty ?? "",
      weighBridgeName: entry.weighBridgeName ?? "",
      warehouseWeightKg: entry.warehouseWeightKg != null ? String(entry.warehouseWeightKg) : "",
      totalDeductionsKg: entry.totalDeductionsKg != null ? String(entry.totalDeductionsKg) : "",
      remarks: entry.remarks ?? "",
    };
  }
  return {
    truckNo: entry.truckNo,
    weightKg: String(entry.weightKg),
    weightAsPerBuiltyKg: String(entry.weightKg),
    bags: entry.kind !== "outbound" && entry.bags != null ? String(entry.bags) : "",
    quantityBagsBales: entry.kind !== "outbound" && entry.bags != null ? String(entry.bags) : "",
    warehouseName: entry.warehouseName,
    counterpartyName: entry.counterpartyName,
    transporterName: entry.driverName ?? "",
    transporterPhone: entry.driverPhone ?? "",
    builtyDetails: entry.kind === "outbound" ? entry.doRef ?? "" : entry.builtyDetails ?? "",
    quantityAsPerBuilty: "",
    weighBridgeName: "",
    warehouseWeightKg: "",
    totalDeductionsKg: "",
    remarks: entry.remarks ?? "",
  };
}

function formToPayload(entry: GateRegisterEntry, form: EditForm): Record<string, unknown> {
  const weight = Number(form.weightKg);
  const weightAsPerBuilty = Number(form.weightAsPerBuiltyKg);
  const bags = form.bags.trim() === "" ? null : Number(form.bags);
  const quantityBagsBales = form.quantityBagsBales.trim() === "" ? null : Number(form.quantityBagsBales);
  if (entry.kind === "pending") {
    return {
      truckNo: form.truckNo.trim(),
      weightKg: weightAsPerBuilty > 0 ? weightAsPerBuilty : weight,
      weightAsPerBuiltyKg: weightAsPerBuilty > 0 ? weightAsPerBuilty : weight,
      bags: quantityBagsBales ?? bags,
      quantityBagsBales,
      warehouseName: form.warehouseName.trim(),
      counterpartyName: form.counterpartyName.trim(),
      transporterName: form.transporterName.trim() || null,
      transporterPhone: form.transporterPhone.trim() || null,
      builtyDetails: form.builtyDetails.trim(),
      quantityAsPerBuilty: form.quantityAsPerBuilty.trim() || null,
      weighBridgeName: form.weighBridgeName.trim() || null,
      warehouseWeightKg: form.warehouseWeightKg.trim() === "" ? null : Number(form.warehouseWeightKg),
      totalDeductionsKg: form.totalDeductionsKg.trim() === "" ? null : Number(form.totalDeductionsKg),
      remarks: form.remarks.trim() || null,
    };
  }
  if (entry.kind === "inbound") {
    return {
      truckNo: form.truckNo.trim(),
      warehouseName: form.warehouseName.trim(),
      sellerName: form.counterpartyName.trim(),
      driverName: form.transporterName.trim() || null,
      driverPhone: form.transporterPhone.trim() || null,
      biltyNo: form.builtyDetails.trim() || "-",
      bags: quantityBagsBales ?? bags,
      weightSpotKg: weightAsPerBuilty > 0 ? weightAsPerBuilty : weight,
      weightWarehouseKg:
        form.warehouseWeightKg.trim() === "" ? weight : Number(form.warehouseWeightKg),
      remarks: form.remarks.trim() || null,
    };
  }
  return {
    truckNo: form.truckNo.trim(),
    warehouseName: form.warehouseName.trim(),
    buyerName: form.counterpartyName.trim(),
    liftedBy: form.transporterName.trim() || form.counterpartyName.trim(),
    driverName: form.transporterName.trim() || null,
    driverPhone: form.transporterPhone.trim() || null,
    dispatchWeightKg: weightAsPerBuilty > 0 ? weightAsPerBuilty : weight,
    invoiceWeightKg: weightAsPerBuilty > 0 ? weightAsPerBuilty : weight,
    doRef: form.builtyDetails.trim() || entry.gatepassNo,
    remarks: form.remarks.trim() || null,
  };
}

function entityMeta(entry: GateRegisterEntry) {
  if (entry.kind === "pending") {
    return { entityType: "GATE_ENTRY", entityRef: entry.id, entityLabel: `${entry.gatepassNo} · ${entry.truckNo}` };
  }
  if (entry.kind === "inbound") {
    return {
      entityType: "INBOUND",
      entityRef: entry.id,
      entityLabel: `${entry.gatepassNo} · ${entry.truckNo} · ${entry.tradeRef}`,
    };
  }
  return {
    entityType: "OUTBOUND",
    entityRef: entry.id,
    entityLabel: `${entry.gatepassNo} · ${entry.truckNo} · ${entry.tradeRef}`,
  };
}

export function GateRegisterActions({ entry, compact }: { entry: GateRegisterEntry; compact?: boolean }) {
  const { role, isHead } = useTeam();
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");
  const utils = trpc.useUtils();
  const meta = entityMeta(entry);

  const [modalOpen, setModalOpen] = useState(false);
  const [action, setAction] = useState<ChangeRequestAction>("DELETE");
  const [comment, setComment] = useState("");
  const [editForm, setEditForm] = useState<EditForm>(() => entryToForm(entry));
  const [submitted, setSubmitted] = useState(false);

  const deleteGate = trpc.execution.deleteGateEntry.useMutation({
    onSuccess: () => invalidateGateOpsCaches(utils),
  });
  const deleteInbound = trpc.execution.deleteInboundReceipt.useMutation({
    onSuccess: () => invalidateGateOpsCaches(utils),
  });
  const deleteOutbound = trpc.execution.deleteOutboundDispatch.useMutation({
    onSuccess: () => invalidateGateOpsCaches(utils),
  });
  const updateGate = trpc.execution.updateGateEntry.useMutation({
    onSuccess: () => {
      setModalOpen(false);
      invalidateGateOpsCaches(utils);
    },
  });
  const updateInbound = trpc.execution.updateInboundReceipt.useMutation({
    onSuccess: () => {
      setModalOpen(false);
      invalidateGateOpsCaches(utils);
    },
  });
  const updateOutbound = trpc.execution.updateOutboundDispatch.useMutation({
    onSuccess: () => {
      setModalOpen(false);
      invalidateGateOpsCaches(utils);
    },
  });
  const submitRequest = trpc.team.submitChangeRequest.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setComment("");
      invalidateApprovalCaches(utils);
    },
  });

  const btn = compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  const pendingLocked = entry.kind === "pending" && entry.status === "ASSIGNED";

  function saveDirect() {
    const payload = formToPayload(entry, editForm);
    if (entry.kind === "pending") {
      updateGate.mutate({ ...(payload as Omit<Parameters<typeof updateGate.mutate>[0], "id">), id: entry.id });
    } else if (entry.kind === "inbound") {
      updateInbound.mutate({ ...(payload as Omit<Parameters<typeof updateInbound.mutate>[0], "id">), id: entry.id });
    } else {
      updateOutbound.mutate({ ...(payload as Omit<Parameters<typeof updateOutbound.mutate>[0], "id">), id: entry.id });
    }
  }

  function deleteDirect() {
    if (entry.kind === "pending") deleteGate.mutate({ id: entry.id });
    else if (entry.kind === "inbound") deleteInbound.mutate({ id: entry.id });
    else deleteOutbound.mutate({ id: entry.id });
  }

  const saving = updateGate.isPending || updateInbound.isPending || updateOutbound.isPending;
  const deleting = deleteGate.isPending || deleteInbound.isPending || deleteOutbound.isPending;
  const saveError = updateGate.error ?? updateInbound.error ?? updateOutbound.error;

  if (pendingLocked) {
    return <span className="text-[10px] text-subtle">Fully assigned</span>;
  }

  if (isExecutionHead) {
    return (
      <>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => {
              setEditForm(entryToForm(entry));
              setAction("EDIT");
              setModalOpen(true);
            }}
            className={`inline-flex items-center gap-1 rounded-md border border-kastros-border bg-white/5 font-medium text-muted-foreground hover:bg-foreground/10 ${btn}`}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              if (confirm(`Delete ${meta.entityLabel}? Inventory and trade links will update.`)) deleteDirect();
            }}
            className={`inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50 ${btn}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "…" : "Delete"}
          </button>
        </div>
        {modalOpen && action === "EDIT" && (
          <EditModal
            entry={entry}
            form={editForm}
            setForm={setEditForm}
            onClose={() => setModalOpen(false)}
            onSave={saveDirect}
            saving={saving}
            error={saveError?.message}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => {
            setEditForm(entryToForm(entry));
            setSubmitted(false);
            setAction("DELETE");
            setModalOpen(true);
          }}
          className={`inline-flex items-center gap-1 rounded-md border border-kastros-border bg-white/5 font-medium text-muted-foreground hover:bg-foreground/10 ${btn}`}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Request change
        </button>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setModalOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-kastros-border bg-kastros-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Request a change</h3>
                <p className="mt-0.5 text-xs text-subtle">
                  Approved edits update inventory, warehouse stock, and linked trades.
                </p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="text-subtle hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 rounded-lg border border-kastros-border bg-black/20 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-subtle">{meta.entityType}</div>
              <div className="font-mono text-sm text-foreground">{meta.entityLabel}</div>
              <div className="mt-1 text-[11px] text-subtle">Generated {fmtGeneratedAt(entry.generatedAt)}</div>
            </div>

            {submitted ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-300">
                  Request sent to the head of execution. It will appear in their Approvals inbox for review.
                </div>
                <div className="flex justify-end gap-2">
                  <Link
                    href="/execution/my-approvals"
                    className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5"
                  >
                    View my requests
                  </Link>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4 flex gap-2">
                  {(["EDIT", "DELETE"] as ChangeRequestAction[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAction(a)}
                      className={`flex-1 rounded-md border px-3 py-2 text-xs font-semibold ${
                        action === a
                          ? a === "DELETE"
                            ? "border-red-500/50 bg-red-500/15 text-red-300"
                            : "border-success/50 bg-success/15 text-success"
                          : "border-kastros-border text-muted-foreground hover:bg-foreground/5"
                      }`}
                    >
                      {a === "EDIT" ? "Edit" : "Delete"}
                    </button>
                  ))}
                </div>

                {action === "EDIT" && (
                  <div className="mt-3 space-y-2">
                    <EditFields entry={entry} form={editForm} setForm={setEditForm} />
                  </div>
                )}

                <div className="mt-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Comment for the head *</div>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="Explain what is wrong and what should change…"
                    className="w-full rounded-md border border-kastros-border bg-black/20 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-success focus:outline-none"
                  />
                </div>

                {submitRequest.error && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {submitRequest.error.message}
                  </div>
                )}

                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setModalOpen(false)} className="rounded-md border border-kastros-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={submitRequest.isPending || comment.trim().length === 0}
                    onClick={() =>
                      submitRequest.mutate({
                        department: "EXECUTION",
                        entityType: meta.entityType,
                        entityRef: meta.entityRef,
                        entityLabel: meta.entityLabel,
                        action,
                        comment: comment.trim(),
                        payload: action === "EDIT" ? formToPayload(entry, editForm) : undefined,
                      })
                    }
                    className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-kastros-bg hover:opacity-90 disabled:opacity-50"
                  >
                    {submitRequest.isPending ? "Sending…" : "Send request"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function EditFields({
  entry,
  form,
  setForm,
}: {
  entry: GateRegisterEntry;
  form: EditForm;
  setForm: React.Dispatch<React.SetStateAction<EditForm>>;
}) {
  const fields: { key: keyof EditForm; label: string; type?: string }[] = [
    { key: "truckNo", label: "Truck no." },
    { key: "builtyDetails", label: entry.kind === "outbound" ? "DO / document ref" : "Builty / consignment" },
    { key: "transporterName", label: "Transporter name" },
    { key: "transporterPhone", label: "Transporter number" },
    { key: "weightAsPerBuiltyKg", label: "Weight as per builty (kg)", type: "number" },
    ...(entry.kind === "pending"
      ? [
          { key: "quantityAsPerBuilty" as const, label: "Quantity as per builty" },
          { key: "weighBridgeName" as const, label: "Weigh bridge name" },
        ]
      : []),
    ...(entry.kind !== "outbound"
      ? [
          { key: "quantityBagsBales" as const, label: "Quantity (bags / bales)", type: "number" },
          { key: "warehouseWeightKg" as const, label: "Warehouse weight (kg)", type: "number" },
          { key: "totalDeductionsKg" as const, label: "Total deductions (kg)", type: "number" },
        ]
      : []),
    { key: "warehouseName", label: "Warehouse" },
    { key: "counterpartyName", label: entry.kind === "outbound" ? "Buyer" : "Counterparty" },
    { key: "remarks", label: "Remarks" },
  ];
  return (
    <>
      {fields.map(({ key, label, type }) => (
        <label key={key} className="block text-xs text-subtle">
          {label}
          <input
            type={type ?? "text"}
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className="kastros-input mt-1 w-full"
          />
        </label>
      ))}
      {entry.kind !== "pending" && (
        <p className="text-[10px] text-subtle">
          Trade {entry.tradeRef} · saving updates fulfillment qty and warehouse inventory.
        </p>
      )}
    </>
  );
}

function EditModal({
  entry,
  form,
  setForm,
  onClose,
  onSave,
  saving,
  error,
}: {
  entry: GateRegisterEntry;
  form: EditForm;
  setForm: React.Dispatch<React.SetStateAction<EditForm>>;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error?: string;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-kastros-border bg-kastros-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-foreground">Edit gate register entry</h3>
        <p className="mt-1 text-xs text-subtle">
          Generated {fmtGeneratedAt(entry.generatedAt)} · updates inventory, warehouse stock, and linked trades.
        </p>
        <GateInvoiceSummary entry={entry} />
        <div className="mt-3 space-y-2">
          <EditFields entry={entry} form={form} setForm={setForm} />
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onSave} disabled={saving} className="kastros-btn-primary text-xs">
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose} className="kastros-btn-secondary text-xs">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function GateInvoiceSummary({ entry }: { entry: GateRegisterEntry }) {
  if (entry.kind === "outbound") return null;
  if (entry.kind === "pending" && entry.movementType !== "INBOUND") return null;

  const invoiceNo = entry.gateInvoiceNo;
  const qtyMt = entry.gateInvoiceQtyMt;
  const amount = entry.gateInvoiceAmount;
  const currency = entry.gateInvoiceCurrency;

  if (!invoiceNo && qtyMt == null && amount == null) {
    if (entry.kind === "pending" && !entry.gateInvoiceTradeRef) {
      return (
        <div className="mt-3 rounded-lg border border-border bg-foreground/[0.03] px-3 py-2.5 text-xs text-subtle">
          Enter the gate invoice from the truck workflow on Truck Movements after assigning this
          truck to a locked purchase trade.
        </div>
      );
    }
    return null;
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-foreground/[0.03] px-3 py-2.5 text-xs">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Gate invoice</div>
      {invoiceNo ? (
        <div className="mt-1 font-mono text-sm font-semibold text-foreground">{invoiceNo}</div>
      ) : (
        <div className="mt-1 text-subtle">Invoice number pending warehouse weighment</div>
      )}
      {qtyMt != null && (
        <div className="mt-1 text-muted-foreground">
          Invoiced qty: {formatQtyWithUnit(qtyMt, "MT", 3)}
          {entry.kind === "pending" && entry.gateInvoiceWeightKg != null
            ? ` (${new Intl.NumberFormat("en-PK").format(entry.gateInvoiceWeightKg)} kg net)`
            : ""}
        </div>
      )}
      {amount != null && (
        <div className="mt-1 font-medium text-accent-secondary">
          Amount: {formatCurrency(amount, currency ?? "PKR")}
        </div>
      )}
      {entry.kind === "pending" && entry.gateInvoiceTradeRef && (
        <div className="mt-1 text-subtle">Rate from {entry.gateInvoiceTradeRef}</div>
      )}
      {entry.kind === "pending" && entry.gateInvoiceStage && (
        <div className="mt-1 text-subtle">
          Status: <span className="text-foreground">{GATE_INVOICE_STAGE_LABELS[entry.gateInvoiceStage]}</span>
        </div>
      )}
    </div>
  );
}


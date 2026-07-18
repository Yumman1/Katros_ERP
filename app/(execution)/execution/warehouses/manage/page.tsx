"use client";

import { WarehouseSubnav } from "@/components/execution/warehouse-subnav";
import {
  costingFormFromLocation,
  emptyCostingForm,
  parseCostingForm,
  WarehouseCostingFields,
  type WarehouseCostingFormState,
} from "@/components/execution/warehouse-costing-fields";
import { PageHeader } from "@/components/ui/page-header";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";
import { trpc } from "@/lib/trpc/client";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment } from "@/lib/departments";
import type { WarehouseLaborLine } from "@/lib/warehouse-costing";
import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type FormState = {
  name: string;
  code: string;
  lsp: string;
  address: string;
  city: string;
  province: string;
  capacitySqFt: string;
  costPerSqFt: string;
  balesDivisionSqFt: string;
  grainDivisionSqFt: string;
};

type Loc = {
  id: string;
  name: string;
  code?: string | null;
  lsp?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  capacitySqFt?: number | null;
  costPerSqFt?: number | null;
  balesDivisionSqFt?: number | null;
  grainDivisionSqFt?: number | null;
  serviceStartDate?: string | null;
  rentalTaxPkr?: number | null;
  managementFeePct?: number | null;
  hiringPeriodMonths?: number | null;
  laborLines?: WarehouseLaborLine[] | null;
};

function locToForm(loc: Loc): FormState {
  return {
    name: loc.name,
    code: loc.code ?? "",
    lsp: loc.lsp ?? "",
    address: loc.address ?? "",
    city: loc.city ?? "",
    province: loc.province ?? "",
    capacitySqFt: loc.capacitySqFt != null ? String(loc.capacitySqFt) : "",
    costPerSqFt: loc.costPerSqFt != null ? String(loc.costPerSqFt) : "",
    balesDivisionSqFt: loc.balesDivisionSqFt != null ? String(loc.balesDivisionSqFt) : "4.5",
    grainDivisionSqFt: loc.grainDivisionSqFt != null ? String(loc.grainDivisionSqFt) : "7",
  };
}

function parseForm(form: FormState, costing: WarehouseCostingFormState) {
  return {
    name: form.name.trim(),
    code: form.code.trim() || undefined,
    lsp: form.lsp.trim() || undefined,
    address: form.address.trim() || undefined,
    city: form.city.trim() || undefined,
    province: form.province.trim() || undefined,
    capacitySqFt: form.capacitySqFt ? Number(form.capacitySqFt) : undefined,
    costPerSqFt: form.costPerSqFt ? Number(form.costPerSqFt) : undefined,
    balesDivisionSqFt: form.balesDivisionSqFt ? Number(form.balesDivisionSqFt) : undefined,
    grainDivisionSqFt: form.grainDivisionSqFt ? Number(form.grainDivisionSqFt) : undefined,
    ...parseCostingForm(costing),
  };
}

export default function WarehouseManagePage() {
  const utils = trpc.useUtils();
  const { role, isHead } = useTeam();
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");

  const { data: locations, isLoading } = trpc.execution.warehouseLocations.useQuery();
  const locationsPagination = useListPagination(locations ?? []);
  const updateWarehouse = trpc.execution.updateWarehouseLocation.useMutation({
    onSuccess: () => {
      setEditingId(null);
      setModal(null);
      void utils.execution.warehouseLocations.invalidate();
    },
  });
  const submitRequest = trpc.team.submitChangeRequest.useMutation({
    onSuccess: () => {
      setModal(null);
      setEditingId(null);
      void utils.team.myChangeRequests.invalidate();
    },
  });
  const deleteWarehouse = trpc.execution.deleteWarehouseLocation.useMutation({
    onSuccess: () => {
      setModal(null);
      void utils.execution.warehouseLocations.invalidate();
      void utils.trader.referenceData.invalidate();
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [costing, setCosting] = useState<WarehouseCostingFormState>(emptyCostingForm);
  const [modal, setModal] = useState<{ type: "EDIT" | "DELETE"; id: string; name: string } | null>(null);
  const [comment, setComment] = useState("");

  function startEdit(loc: NonNullable<typeof locations>[number]) {
    setEditingId(loc.id);
    setForm(locToForm(loc));
    setCosting(costingFormFromLocation(loc));
    setComment("");
  }

  function saveDirect() {
    if (!editingId || !form) return;
    updateWarehouse.mutate({ id: editingId, ...parseForm(form, costing) });
  }

  function submitApproval() {
    if (!modal || !comment.trim()) return;
    if (modal.type === "DELETE") {
      if (isExecutionHead) {
        if (confirm(`Delete warehouse ${modal.name}?`)) {
          deleteWarehouse.mutate({ id: modal.id });
        }
        return;
      }
      submitRequest.mutate({
        entityType: "WAREHOUSE",
        entityRef: modal.id,
        entityLabel: `Delete warehouse ${modal.name}`,
        action: "DELETE",
        comment: comment.trim(),
        department: "EXECUTION",
      });
      return;
    }
    if (!form) return;
    submitRequest.mutate({
      entityType: "WAREHOUSE",
      entityRef: modal.id,
      entityLabel: `Update warehouse ${modal.name}`,
      action: "EDIT",
      comment: comment.trim(),
      department: "EXECUTION",
      payload: parseForm(form, costing),
    });
  }

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution/warehouses" className="hover:text-foreground">
              Warehouses
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Manage</span>
          </>
        }
        title="Update & delete warehouses"
        subtitle={
          isExecutionHead
            ? "As head of execution you can apply changes directly."
            : "Submit update or delete requests — the head of execution approves them on the Approvals page."
        }
        actions={
          !isExecutionHead ? (
            <Link href="/execution/approvals" className="kastros-btn-secondary text-xs">
              My requests
            </Link>
          ) : (
            <Link href="/execution/approvals" className="kastros-btn-secondary text-xs">
              Approvals inbox
            </Link>
          )
        }
      />

      <WarehouseSubnav />

      {!isExecutionHead && (
        <div className="exec-alert-warning text-xs">
          Warehouse edits and deletions require head of execution approval. Add a clear note explaining why the change
          is needed.
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-subtle">Loading…</p>
      ) : (
        <>
        <div className="grid gap-3 lg:grid-cols-2">
          {locationsPagination.items.map((loc) => (
            <div key={loc.id} className="exec-panel">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">{loc.name}</div>
                  <div className="text-xs text-subtle">{loc.code ?? loc.id}</div>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(loc)}
                    className="kastros-btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModal({ type: "DELETE", id: loc.id, name: loc.name });
                      setComment("");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <ListPagination
          page={locationsPagination.page}
          totalPages={locationsPagination.totalPages}
          totalItems={locationsPagination.totalItems}
          startIndex={locationsPagination.startIndex}
          endIndex={locationsPagination.endIndex}
          onPageChange={locationsPagination.setPage}
        />
        </>
      )}

      {editingId && form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">Edit warehouse</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {(
                [
                  ["name", "Name"],
                  ["code", "Code"],
                  ["city", "City"],
                  ["province", "Province"],
                  ["capacitySqFt", "Square feet"],
                  ["costPerSqFt", "Rental / sq ft (PKR)"],
                  ["grainDivisionSqFt", "Grain sq ft / MT"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-xs text-subtle">
                  {label}
                  <input
                    value={form[key]}
                    onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
                    className="kastros-input mt-1 w-full"
                  />
                </label>
              ))}
            </div>
            <WarehouseCostingFields
              costing={costing}
              onChange={setCosting}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {isExecutionHead ? (
                <button type="button" onClick={saveDirect} disabled={updateWarehouse.isPending} className="kastros-btn-primary text-xs">
                  Save changes
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const loc = locations?.find((l) => l.id === editingId);
                    if (loc) setModal({ type: "EDIT", id: loc.id, name: loc.name });
                  }}
                  className="kastros-btn-primary text-xs"
                >
                  Submit for approval
                </button>
              )}
              <button type="button" onClick={() => { setEditingId(null); setForm(null); setCosting(emptyCostingForm()); }} className="kastros-btn-secondary text-xs">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">
              {modal.type === "DELETE"
                ? isExecutionHead
                  ? "Delete warehouse"
                  : "Request deletion"
                : "Confirm approval request"}
            </h3>
            <p className="mt-1 text-xs text-subtle">{modal.name}</p>
            {!(modal.type === "DELETE" && isExecutionHead) && (
              <label className="mt-3 block text-xs text-subtle">
                Note for head of execution *
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="kastros-input mt-1 w-full"
                  placeholder="Why is this change needed?"
                />
              </label>
            )}
            {modal.type === "DELETE" && isExecutionHead && (
              <p className="mt-2 text-xs text-subtle">As head of execution you can delete immediately.</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={
                  submitRequest.isPending ||
                  deleteWarehouse.isPending ||
                  (!isExecutionHead && !comment.trim())
                }
                onClick={submitApproval}
                className="kastros-btn-primary text-xs disabled:opacity-50"
              >
                {modal.type === "DELETE" && isExecutionHead
                  ? deleteWarehouse.isPending
                    ? "Deleting…"
                    : "Delete now"
                  : submitRequest.isPending
                    ? "Sending…"
                    : "Send to approvals"}
              </button>
              <button type="button" onClick={() => setModal(null)} className="kastros-btn-secondary text-xs">
                Cancel
              </button>
            </div>
            {submitRequest.error && (
              <p className="mt-2 text-xs text-destructive">{submitRequest.error.message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

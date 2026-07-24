"use client";

import { WarehouseSubnav } from "@/components/execution/warehouse-subnav";
import {
  emptyCostingForm,
  parseCostingForm,
  WarehouseCostingFields,
  type WarehouseCostingFormState,
} from "@/components/execution/warehouse-costing-fields";
import { WarehouseStorageMetricsPreview } from "@/components/execution/warehouse-storage-metrics-preview";
import { computeWarehouseCosting } from "@/lib/warehouse-costing";
import { PageHeader } from "@/components/ui/page-header";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";
import { trpc } from "@/lib/trpc/client";
import { useTeam } from "@/lib/use-team";
import { canActOnDepartment } from "@/lib/departments";
import { Send } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

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

const emptyForm = (): FormState => ({
  name: "",
  code: "",
  lsp: "",
  address: "",
  city: "",
  province: "",
  capacitySqFt: "",
  costPerSqFt: "",
  balesDivisionSqFt: "",
  grainDivisionSqFt: "7",
});

function parseForm(form: FormState, costing: WarehouseCostingFormState) {
  return {
    name: form.name.trim(),
    // WH code is auto-generated server-side (next free K###).
    code: undefined,
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

export default function WarehouseSetupPage() {
  const utils = trpc.useUtils();
  const { role, isHead } = useTeam();
  const isExecutionHead = role != null && canActOnDepartment(role, isHead, "EXECUTION");

  const { data: locations, isLoading } = trpc.execution.warehouseLocations.useQuery();
  const locationsPagination = useListPagination(locations ?? []);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [costing, setCosting] = useState<WarehouseCostingFormState>(emptyCostingForm);
  const [comment, setComment] = useState("");
  const [requestSent, setRequestSent] = useState(false);

  const submitRequest = trpc.team.submitChangeRequest.useMutation({
    onSuccess: () => {
      setForm(emptyForm());
      setCosting(emptyCostingForm());
      setComment("");
      setRequestSent(true);
      void utils.team.myChangeRequests.invalidate();
      void utils.ceo.approvalQueue.invalidate();
    },
  });

  const storageMetricsInput = useMemo(() => {
    const parsed = parseCostingForm(costing);
    return {
      capacitySqFt: form.capacitySqFt ? Number(form.capacitySqFt) : 0,
      grainDivisionSqFt: form.grainDivisionSqFt ? Number(form.grainDivisionSqFt) : 7,
      rentalPerSqFtMonth: form.costPerSqFt ? Number(form.costPerSqFt) : 0,
      rentalTaxPkr: parsed.rentalTaxPkr,
      laborLines: parsed.laborLines,
      managementFeePct: parsed.managementFeePct,
    };
  }, [form, costing]);

  const storageMetricsSummary = useMemo(
    () => computeWarehouseCosting(storageMetricsInput),
    [storageMetricsInput],
  );

  function submit() {
    const payload = parseForm(form, costing);
    if (!payload.name) return;
    setRequestSent(false);

    const note =
      comment.trim() ||
      (isExecutionHead ? "Submitted by execution head for CEO approval." : "");

    if (!isExecutionHead && !comment.trim()) return;

    submitRequest.mutate({
      department: "EXECUTION",
      entityType: "WAREHOUSE",
      entityRef: `new-${payload.name.toLowerCase().replace(/\s+/g, "-")}`,
      entityLabel: `Create warehouse ${payload.name}`,
      action: "CREATE",
      comment: note,
      payload,
    });
  }

  return (
    <div className="kastros-desk-page">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/execution" className="hover:text-foreground">
              Desk
            </Link>
            <span>/</span>
            <Link href="/execution/warehouses" className="hover:text-foreground">
              Warehouses
            </Link>
            <span>/</span>
            <span className="text-muted-foreground">Setup</span>
          </>
        }
        title="Warehouse setup & details"
        subtitle={
          isExecutionHead
            ? "Submit new warehouses for CEO approval. Storage metrics are shown before you send."
            : "Submit new warehouses for head of execution review, then CEO approval."
        }
        actions={
          <Link href="/execution/approvals" className="kastros-btn-secondary text-xs">
            My requests
          </Link>
        }
      />

      <div className="kastros-desk-scroll space-y-4 pb-6">
      <WarehouseSubnav />

      {!isExecutionHead && (
        <div className="exec-alert-warning text-xs">
          New warehouses require head of execution review, then CEO approval. Add a note explaining why this warehouse is needed.
        </div>
      )}
      {isExecutionHead && (
        <div className="exec-alert-warning text-xs">
          Warehouses you submit go directly to the CEO for final approval (execution head sign-off is not required).
        </div>
      )}

      <section className="exec-panel">
        <div className="border-b border-border pb-4">
          <h2 className="text-sm font-semibold text-foreground">Add warehouse</h2>
          <p className="mt-0.5 text-xs text-subtle">
            Grain and bales share one sq ft pool — more of one type leaves less room for the other.
          </p>
        </div>
        <div className="grid gap-3 pt-4 md:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["name", "Warehouse name", "Al Amin WH SWL"],
              ["lsp", "LSP", "Hellmann"],
              ["city", "Location", "Sahiwal"],
              ["province", "Province", "Punjab"],
              ["capacitySqFt", "Number of square feet", "32000"],
              ["costPerSqFt", "Rental cost per sq ft / month (PKR)", "18"],
              ["balesDivisionSqFt", "Bales division (sq ft/MT)", ""],
              ["grainDivisionSqFt", "Grain division (sq ft/MT)", "6.04"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="block text-xs text-subtle">
              {label}
              <input
                value={form[key]}
                onChange={(e) => {
                  setForm((s) => ({ ...s, [key]: e.target.value }));
                  setRequestSent(false);
                }}
                placeholder={placeholder}
                className="kastros-input mt-1 w-full"
              />
            </label>
          ))}
          <label className="block text-xs text-subtle md:col-span-2 lg:col-span-3">
            Address
            <input
              value={form.address}
              onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))}
              placeholder="Full warehouse address"
              className="kastros-input mt-1 w-full"
            />
          </label>
          {!isExecutionHead && (
            <label className="block text-xs text-subtle md:col-span-2 lg:col-span-3">
              Note for head of execution *
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Why is this warehouse needed?"
                className="kastros-input mt-1 w-full"
              />
            </label>
          )}
          {isExecutionHead && (
            <label className="block text-xs text-subtle md:col-span-2 lg:col-span-3">
              Note for CEO (optional)
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Context for executive approval…"
                className="kastros-input mt-1 w-full"
              />
            </label>
          )}
        </div>
        <WarehouseCostingFields
          costing={costing}
          onChange={(next) => {
            setCosting(next);
            setRequestSent(false);
          }}
        />
        <div className="mt-4">
          <WarehouseStorageMetricsPreview summary={storageMetricsSummary} />
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={submit}
            disabled={
              !form.name.trim() ||
              submitRequest.isPending ||
              (!isExecutionHead && !comment.trim())
            }
            className="kastros-btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {submitRequest.isPending
              ? "Sending…"
              : isExecutionHead
                ? "Submit to CEO"
                : "Submit for approval"}
          </button>
        </div>
        {requestSent && (
          <div className="mt-4 rounded-xl border border-success/30 bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-3 py-2 text-sm text-success">
            {isExecutionHead
              ? "Request sent to CEO for final approval."
              : "Request sent to head of execution for review."}
          </div>
        )}
        {submitRequest.error && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] px-3 py-2 text-sm text-destructive">
            {submitRequest.error.message}
          </div>
        )}
      </section>

      <section className="exec-panel">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Registered warehouses</h2>
        {isLoading ? (
          <p className="text-sm text-subtle">Loading…</p>
        ) : (
          <div className="kastros-table-wrap">
            <table className="kastros-table text-xs">
              <thead>
                <tr>
                  {["Name", "Code", "City", "Province", "Capacity sq ft", "LSP"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {locationsPagination.items.map((loc) => (
                  <tr key={loc.id}>
                    <td className="font-medium text-foreground">{loc.name}</td>
                    <td className="text-muted-foreground">{loc.code ?? "—"}</td>
                    <td className="text-muted-foreground">{loc.city ?? "—"}</td>
                    <td className="text-muted-foreground">{loc.province ?? "—"}</td>
                    <td className="tabular-nums text-muted-foreground">
                      {loc.capacitySqFt?.toLocaleString() ?? "—"}
                    </td>
                    <td className="text-muted-foreground">{loc.lsp ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ListPagination
              page={locationsPagination.page}
              totalPages={locationsPagination.totalPages}
              totalItems={locationsPagination.totalItems}
              startIndex={locationsPagination.startIndex}
              endIndex={locationsPagination.endIndex}
              onPageChange={locationsPagination.setPage}
            />
          </div>
        )}
        <p className="mt-3 text-xs text-subtle">
          To update or delete a warehouse, go to{" "}
          <Link href="/execution/warehouses/manage" className="text-accent-secondary hover:underline">
            Update & delete
          </Link>{" "}
          — changes require head of execution approval unless you are the head.
        </p>
      </section>
      </div>
    </div>
  );
}

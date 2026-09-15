"use client";

import { useRecordFilters } from "@/components/ui/record-filters";
import { field } from "@/lib/record-filters";

/**
 * Internal stock shifting — moving grain we already own between warehouses.
 *
 * Deliberately not a trade screen: there is no counterparty to pick, no rate
 * and no invoice. A shift is booked, gated out of the source, then weighed in
 * at the destination. Between those two steps the load belongs to neither
 * warehouse, which is what the In transit column is showing.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { DESK_REFETCH_MS } from "@/lib/invalidate-caches";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { cn } from "@/lib/utils";
import { ArrowRight, Boxes, MoveRight, PackageCheck, Truck, XCircle } from "lucide-react";

type Status = "DRAFT" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";

const STATUS_STYLE: Record<Status, { label: string; className: string }> = {
  DRAFT: { label: "Booked", className: "bg-slate-100 text-slate-700 border-slate-200" },
  IN_TRANSIT: { label: "In transit", className: "bg-amber-50 text-amber-700 border-amber-200" },
  RECEIVED: { label: "Received", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Cancelled", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

const mt = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toLocaleString("en-PK", { maximumFractionDigits: 3 })} MT`;

export default function ExecutionShiftingPage() {
  const utils = trpc.useUtils();
  const { data: transfers, isLoading } = trpc.execution.stockTransfers.useQuery(
    {},
    { refetchInterval: DESK_REFETCH_MS },
  );
  const { data: warehouses } = trpc.execution.warehouseLocations.useQuery();
  const { data: commodities } = trpc.commodity.list.useQuery();

  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = () => {
    void utils.execution.stockTransfers.invalidate();
    void utils.execution.inboundReceipts.invalidate();
    void utils.execution.outboundDispatches.invalidate();
    // Shifted stock is inventory in a season's book — the net position moves.
    void utils.trader.seasonNetPositions.invalidate();
    void utils.execution.inventoryValuation.invalidate();
  };
  const onError = (e: { message: string }) => setError(e.message);

  const create = trpc.execution.createStockTransfer.useMutation({
    onSuccess: () => {
      setError(null);
      setShowForm(false);
      refresh();
    },
    onError,
  });
  const dispatch = trpc.execution.dispatchStockTransfer.useMutation({
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });
  const receive = trpc.execution.receiveStockTransfer.useMutation({
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });
  const cancel = trpc.execution.cancelStockTransfer.useMutation({
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError,
  });

  const rows = useMemo(() => transfers ?? [], [transfers]);
  const inTransitMt = useMemo(
    () => rows.filter((r) => r.status === "IN_TRANSIT").reduce((s, r) => s + r.dispatchedQtyMt, 0),
    [rows],
  );
  const transitLossMt = useMemo(
    () => rows.reduce((s, r) => s + Math.max(0, r.transitLossMt ?? 0), 0),
    [rows],
  );

  const listFilters = useRecordFilters("shifts", rows, { fields: [field("from", "Origin", "fromWarehouseName", "externalOrigin"), field("to", "Destination", "toWarehouseName"), field("commodity", "Commodity", "commodityCode"), field("season", "Season"), field("status", "Status")], date: { label: "Booking date", paths: ["createdAt"] } });

  if (isLoading) return <PageLoadingSkeleton />;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Internal Shifting</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Move stock we already own between warehouses. No trade, no counterparty and no
            invoice — the source is relieved when the truck gates out and the destination takes it
            on when it is weighed in.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <MoveRight className="h-4 w-4" />
          {showForm ? "Close" : "New shift"}
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={<Truck className="h-4 w-4" />} label="On the road" value={mt(inTransitMt)} />
        <StatCard
          icon={<Boxes className="h-4 w-4" />}
          label="Shifts recorded"
          value={String(rows.length)}
        />
        <StatCard
          icon={<PackageCheck className="h-4 w-4" />}
          label="Transit loss to date"
          value={mt(transitLossMt)}
        />
      </div>

      {listFilters.controls}
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {showForm ? (
        <NewShiftForm
          warehouses={(warehouses ?? []).map((w) => w.name)}
          commodities={(commodities ?? []).map((c) => ({ code: c.code, name: c.name }))}
          submitting={create.isPending}
          onSubmit={(v) => create.mutate(v)}
        />
      ) : null}

      <section className="rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Ref</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Commodity</th>
                <th className="px-4 py-3 font-medium">Truck</th>
                <th className="px-4 py-3 text-right font-medium">Dispatched</th>
                <th className="px-4 py-3 text-right font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    No stock has been shifted yet.
                  </td>
                </tr>
              ) : (
                listFilters.rows.map((r) => (
                  <ShiftRow
                    key={r.id}
                    row={r}
                    busy={dispatch.isPending || receive.isPending || cancel.isPending}
                    onDispatch={() => dispatch.mutate({ id: r.id })}
                    onReceive={(qty) => receive.mutate({ id: r.id, receivedQtyMt: qty })}
                    onCancel={(reason) => cancel.mutate({ id: r.id, reason })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

type ShiftRowData = {
  id: string;
  transferRef: string;
  commodityCode: string;
  commodityName: string;
  fromWarehouseName: string | null;
  externalOrigin: string | null;
  toWarehouseName: string;
  dispatchedQtyMt: number;
  receivedQtyMt: number | null;
  transitLossMt: number | null;
  truckNo: string;
  status: string;
  outGatepassNo: string | null;
  inGatepassNo: string | null;
};

function ShiftRow({
  row,
  busy,
  onDispatch,
  onReceive,
  onCancel,
}: {
  row: ShiftRowData;
  busy: boolean;
  onDispatch: () => void;
  onReceive: (qtyMt: number) => void;
  onCancel: (reason: string) => void;
}) {
  const [receiveQty, setReceiveQty] = useState<string>("");
  const style = STATUS_STYLE[row.status as Status] ?? STATUS_STYLE.DRAFT;
  const source = row.fromWarehouseName ?? row.externalOrigin ?? "—";
  const loss = row.transitLossMt ?? 0;

  return (
    <tr className="border-b last:border-0 align-top">
      <td className="px-4 py-3 font-medium">
        {row.transferRef}
        <div className="mt-0.5 text-xs text-muted-foreground">
          {row.outGatepassNo ?? "—"}
          {row.inGatepassNo ? ` → ${row.inGatepassNo}` : ""}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn(!row.fromWarehouseName && "italic text-muted-foreground")}>
            {source}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{row.toWarehouseName}</span>
        </span>
        {!row.fromWarehouseName ? (
          <div className="mt-0.5 text-xs text-muted-foreground">from outside our warehouses</div>
        ) : null}
      </td>
      <td className="px-4 py-3">{row.commodityName}</td>
      <td className="px-4 py-3">{row.truckNo}</td>
      <td className="px-4 py-3 text-right tabular-nums">{mt(row.dispatchedQtyMt)}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {mt(row.receivedQtyMt)}
        {loss > 0.005 ? (
          <div className="mt-0.5 text-xs text-amber-700">{mt(loss)} short</div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", style.className)}>
          {style.label}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        {row.status === "DRAFT" ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onDispatch}
              className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Gate out
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("Why is this shift being cancelled?");
                if (reason?.trim()) onCancel(reason.trim());
              }}
              className="rounded-md border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
              aria-label="Cancel shift"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : row.status === "IN_TRANSIT" ? (
          <div className="flex items-center justify-end gap-2">
            <input
              type="number"
              step="0.001"
              min="0"
              value={receiveQty}
              onChange={(e) => setReceiveQty(e.target.value)}
              placeholder={String(row.dispatchedQtyMt)}
              className="w-24 rounded-md border px-2 py-1.5 text-right text-xs tabular-nums"
              aria-label="Weighed quantity at destination (MT)"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const qty = Number(receiveQty || row.dispatchedQtyMt);
                if (Number.isFinite(qty) && qty > 0) onReceive(qty);
              }}
              className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Weigh in
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function NewShiftForm({
  warehouses,
  commodities,
  submitting,
  onSubmit,
}: {
  warehouses: string[];
  commodities: { code: string; name: string }[];
  submitting: boolean;
  onSubmit: (v: {
    commodityCode: string;
    commodityName: string;
    fromWarehouseName: string | null;
    externalOrigin: string | null;
    toWarehouseName: string;
    dispatchedQtyMt: number;
    truckNo: string;
    biltyNo: string | null;
    bags: number | null;
    reason: string | null;
    season: "WINTER" | "SUMMER";
  }) => void;
}) {
  const [commodityCode, setCommodityCode] = useState(commodities[0]?.code ?? "");
  const [fromWarehouse, setFromWarehouse] = useState<string>(warehouses[0] ?? "");
  const [externalOrigin, setExternalOrigin] = useState("");
  const [toWarehouse, setToWarehouse] = useState<string>(warehouses[1] ?? warehouses[0] ?? "");
  const [qty, setQty] = useState("");
  const [truckNo, setTruckNo] = useState("");
  const [biltyNo, setBiltyNo] = useState("");
  const [bags, setBags] = useState("");
  const [reason, setReason] = useState("");
  const [season, setSeason] = useState<"WINTER" | "SUMMER">("SUMMER");

  const fromOutside = fromWarehouse === "__external__";
  const commodity = commodities.find((c) => c.code === commodityCode);

  return (
    <form
      className="rounded-lg border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          commodityCode,
          commodityName: commodity?.name ?? commodityCode,
          fromWarehouseName: fromOutside ? null : fromWarehouse,
          externalOrigin: fromOutside ? externalOrigin.trim() || null : null,
          toWarehouseName: toWarehouse,
          dispatchedQtyMt: Number(qty),
          truckNo: truckNo.trim(),
          biltyNo: biltyNo.trim() || null,
          bags: bags ? Number(bags) : null,
          reason: reason.trim() || null,
          season,
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        {/* Shifted stock still belongs to a crop season's position book. */}
        <Field label="Season">
          <select
            value={season}
            onChange={(e) => setSeason(e.target.value as "WINTER" | "SUMMER")}
            className="w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            <option value="SUMMER">Summer</option>
            <option value="WINTER">Winter</option>
          </select>
        </Field>

        <Field label="Commodity">
          <select
            value={commodityCode}
            onChange={(e) => setCommodityCode(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            {commodities.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="From">
          <select
            value={fromWarehouse}
            onChange={(e) => setFromWarehouse(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            {warehouses.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
            <option value="__external__">Outside our warehouses…</option>
          </select>
        </Field>

        <Field label="To">
          <select
            value={toWarehouse}
            onChange={(e) => setToWarehouse(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            {warehouses.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>

        {fromOutside ? (
          <Field label="Name of the outside yard" hint="e.g. Kisan Godam">
            <input
              value={externalOrigin}
              onChange={(e) => setExternalOrigin(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              required
            />
          </Field>
        ) : null}

        <Field label="Quantity (MT)">
          <input
            type="number"
            step="0.001"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm tabular-nums"
            required
          />
        </Field>

        <Field label="Truck no.">
          <input
            value={truckNo}
            onChange={(e) => setTruckNo(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            required
          />
        </Field>

        <Field label="Bilty no." hint="optional">
          <input
            value={biltyNo}
            onChange={(e) => setBiltyNo(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Bags" hint="optional">
          <input
            type="number"
            min="0"
            value={bags}
            onChange={(e) => setBags(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm tabular-nums"
          />
        </Field>

        <Field label="Reason" hint="optional">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Space needed at source"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Booking…" : "Book shift"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 normal-case opacity-70">({hint})</span> : null}
      </span>
      {children}
    </label>
  );
}

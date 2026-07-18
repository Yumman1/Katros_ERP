"use client";

import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatQtyWithUnit } from "@/lib/formatters/numbers";
import { downloadExcel, endOfDay, parseDateInput } from "@/lib/export-excel";
import { cn } from "@/lib/utils";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  Download,
  ExternalLink,
  Search,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  GateRegisterActions,
  type GateRegisterEntry,
} from "@/components/execution/gate-register-actions";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { ListPagination } from "@/components/ui/list-pagination";
import { useListPagination } from "@/lib/use-list-pagination";
import {
  filterUploadedGatepassDocuments,
  gatepassDocumentDisplayName,
} from "@/lib/gatepass-documents";
import type { InboundReceipt, OutboundDispatch, PendingTruck } from "@/server/execution-store";

function uploadedDocs(refs: string[] | null | undefined): string[] {
  return filterUploadedGatepassDocuments(refs);
}

function pendingTransporter(t: PendingTruck) {
  return t.transporterName?.trim() || t.driverName?.trim() || null;
}

const fmtKg = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} kg`;

function fmtGatepassGenerated(d: Date | string) {
  return new Date(d).toLocaleString("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type Movement = {
  id: string;
  type: "INBOUND" | "OUTBOUND";
  date: Date;
  warehouseName: string;
  tradeRef: string;
  commodityCode: string;
  commodityName: string;
  quantityUnit: string;
  counterpartyName: string;
  truckNo: string;
  gatepassNo: string;
  documentRefs: string[];
  grossWeightKg: number;
  netQtyMt: number;
  invoiceNo?: string | null;
  invoiceQtyMt?: number | null;
  invoiceQtyUnit?: string | null;
  invoiceAmount?: number | null;
  invoiceCurrency?: string | null;
  status: string;
  driverName?: string | null;
  isPendingGatepass?: boolean;
  /** Original pending-truck id when row comes from unassigned gatepass queue. */
  pendingTruckId?: string;
  sourceKind: "pending" | "inbound" | "outbound";
  sourceId: string;
};

const REFETCH_MS = 60_000;

export default function TruckMovementsPage() {
  const { data: contracts, isLoading: loadingContracts } = trpc.execution.lockedContracts.useQuery({});
  const { data: inbound, isLoading: loadingInbound } = trpc.execution.inboundReceipts.useQuery({});
  const { data: outbound, isLoading: loadingOutbound } = trpc.execution.outboundDispatches.useQuery({});
  const { data: pendingTrucks, isLoading: loadingPending } = trpc.execution.pendingTrucks.useQuery(
    {},
    { refetchInterval: REFETCH_MS },
  );
  const movementsLoading = loadingContracts || loadingInbound || loadingOutbound || loadingPending;

  const [warehouseFilter, setWarehouseFilter] = useState("ALL");
  const [commodityFilter, setCommodityFilter] = useState("ALL");
  const [movementFilter, setMovementFilter] = useState<"ALL" | "INBOUND" | "OUTBOUND">("ALL");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const contractByRef = useMemo(
    () => new Map((contracts ?? []).map((c) => [c.tradeRef, c])),
    [contracts],
  );

  const movements = useMemo<Movement[]>(() => {
    const inboundRows: Movement[] = (inbound ?? []).map((r) => {
      const c = contractByRef.get(r.tradeRef);
      return {
        id: r.id,
        type: "INBOUND",
        date: r.receiveDate,
        warehouseName: r.warehouseName,
        tradeRef: r.tradeRef,
        commodityCode: c?.commodityCode ?? "-",
        commodityName: c?.commodityName ?? "Commodity",
        quantityUnit: c?.quantityUnit ?? "MT",
        counterpartyName: r.sellerName,
        truckNo: r.truckNo,
        gatepassNo: r.gatepassNo ?? r.kcsNo,
        documentRefs: uploadedDocs(r.documentRefs),
        grossWeightKg: r.weightWarehouseKg,
        netQtyMt: r.allocatedQtyMt,
        invoiceNo: r.billNo,
        invoiceQtyMt: r.allocatedQtyMt,
        invoiceQtyUnit: c?.quantityUnit ?? "MT",
        invoiceAmount: r.amountDue,
        invoiceCurrency: c?.currency ?? null,
        status: r.status,
        driverName: r.driverName,
        sourceKind: "inbound",
        sourceId: r.id,
      };
    });

    const outboundRows: Movement[] = (outbound ?? []).map((d) => {
      const c = contractByRef.get(d.tradeRef);
      return {
        id: d.id,
        type: "OUTBOUND",
        date: d.dispatchDate,
        warehouseName: d.warehouseName,
        tradeRef: d.tradeRef,
        commodityCode: c?.commodityCode ?? "-",
        commodityName: c?.commodityName ?? "Commodity",
        quantityUnit: c?.quantityUnit ?? "MT",
        counterpartyName: d.buyerName,
        truckNo: d.truckNo,
        gatepassNo: d.gatepassNo ?? d.doRef ?? d.id,
        documentRefs: uploadedDocs(d.documentRefs),
        grossWeightKg: d.dispatchWeightKg,
        netQtyMt: d.allocatedQtyMt,
        status: d.status,
        driverName: d.driverName,
        sourceKind: "outbound",
        sourceId: d.id,
      };
    });

    const pendingRows: Movement[] = (pendingTrucks ?? [])
      .filter((t) => t.status !== "ASSIGNED")
      .map((t) => ({
        id: `pending-${t.id}`,
        type: t.movementType,
        date: t.arrivalDate,
        warehouseName: t.warehouseName,
        tradeRef: "—",
        commodityCode: t.commodityCode ?? "-",
        commodityName: t.commodityName ?? "Commodity",
        quantityUnit: "KG",
        counterpartyName: t.counterpartyName,
        truckNo: t.truckNo,
        gatepassNo: t.gatepassNo,
        documentRefs: uploadedDocs(t.documentRefs),
        grossWeightKg: t.remainingKg,
        netQtyMt: t.gateInvoiceQtyMt ?? t.remainingKg / 1000,
        invoiceNo: t.assignedTradeRef ? t.gateInvoiceNo : null,
        invoiceQtyMt: t.assignedTradeRef ? t.gateInvoiceQtyMt : null,
        invoiceQtyUnit: t.assignedTradeRef && t.gateInvoiceQtyMt != null ? "MT" : "KG",
        invoiceAmount: t.assignedTradeRef ? t.gateInvoiceAmount : null,
        invoiceCurrency: t.assignedTradeRef ? t.gateInvoiceCurrency : null,
        status: t.status === "PARTIAL" ? "GATEPASS_PARTIAL" : "GATEPASS_PENDING",
        driverName: pendingTransporter(t),
        isPendingGatepass: true,
        pendingTruckId: t.id,
        sourceKind: "pending",
        sourceId: t.id,
      }));

    return [...pendingRows, ...inboundRows, ...outboundRows].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [contractByRef, inbound, outbound, pendingTrucks]);

  const pendingTruckById = useMemo(
    () => new Map((pendingTrucks ?? []).map((t) => [t.id, t])),
    [pendingTrucks],
  );

  const inboundById = useMemo(() => new Map((inbound ?? []).map((r) => [r.id, r])), [inbound]);
  const outboundById = useMemo(() => new Map((outbound ?? []).map((d) => [d.id, d])), [outbound]);

  const warehouseOptions = useMemo(() => {
    const set = new Set<string>();
    movements.forEach((m) => set.add(m.warehouseName));
    return ["ALL", ...Array.from(set).sort()];
  }, [movements]);

  const commodityCodes = useMemo(() => {
    const codes = new Set<string>();
    movements.forEach((m) => {
      if (m.commodityCode !== "-") codes.add(m.commodityCode);
    });
    return Array.from(codes).sort();
  }, [movements]);

  const filteredMovements = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = parseDateInput(dateFrom);
    const to = dateTo ? endOfDay(parseDateInput(dateTo)!) : null;
    return movements.filter((m) => {
      if (warehouseFilter !== "ALL" && m.warehouseName !== warehouseFilter) return false;
      if (commodityFilter !== "ALL" && m.commodityCode !== commodityFilter) return false;
      if (movementFilter !== "ALL" && m.type !== movementFilter) return false;
      if (from && new Date(m.date) < from) return false;
      if (to && new Date(m.date) > to) return false;
      if (!q) return true;
      return [
        m.tradeRef,
        m.warehouseName,
        m.truckNo,
        m.gatepassNo,
        m.invoiceNo ?? "",
        m.counterpartyName,
        m.commodityCode,
        m.driverName ?? "",
        ...m.documentRefs,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [movementFilter, movements, query, warehouseFilter, commodityFilter, dateFrom, dateTo]);

  const unassignedTrucks = useMemo(
    () => (pendingTrucks ?? []).filter((t) => t.status !== "ASSIGNED"),
    [pendingTrucks],
  );

  const movementFilterKey = `${warehouseFilter}|${commodityFilter}|${movementFilter}|${query}|${dateFrom}|${dateTo}`;
  const unassignedPagination = useListPagination(unassignedTrucks);
  const movementsPagination = useListPagination(filteredMovements, { resetKey: movementFilterKey });

  function exportFilteredExcel() {
    if (filteredMovements.length === 0) return;
    const rows = filteredMovements.map((m) => ({
      Type: m.type,
      Gatepass: m.gatepassNo,
      Invoice: m.invoiceNo ?? "",
      Date: fmtGatepassGenerated(m.date),
      Truck: m.truckNo,
      Transporter: m.driverName ?? "",
      Trade: m.tradeRef,
      Warehouse: m.warehouseName,
      Commodity: m.commodityCode,
      CommodityName: m.commodityName,
      Counterparty: m.counterpartyName,
      NetQty: formatQtyWithUnit(m.invoiceQtyMt ?? m.netQtyMt, m.invoiceQtyUnit ?? m.quantityUnit, 3),
      Unit: m.invoiceQtyUnit ?? m.quantityUnit,
      InvoiceAmount:
        m.invoiceAmount != null
          ? formatCurrency(m.invoiceAmount, m.invoiceCurrency ?? "PKR")
          : "",
      GrossKg: m.grossWeightKg,
      Documents: m.documentRefs.map(gatepassDocumentDisplayName).join(" · "),
      Status: m.status,
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    const range = dateFrom || dateTo ? `-${dateFrom || "start"}_${dateTo || "end"}` : "";
    downloadExcel(rows, "Movements", `truck-movements${range}-${stamp}.xlsx`);
  }

  const today = new Date().toDateString();
  const vehiclesToday = movements.filter((m) => new Date(m.date).toDateString() === today).length;
  const pendingInbound = (pendingTrucks ?? []).filter(
    (t) => t.movementType === "INBOUND" && t.status !== "ASSIGNED",
  ).length;
  const pendingOutbound = (pendingTrucks ?? []).filter(
    (t) => t.movementType === "OUTBOUND" && t.status !== "ASSIGNED",
  ).length;
  const unassignedGatepassCount = (pendingTrucks ?? []).filter((t) => t.status !== "ASSIGNED").length;

  if (movementsLoading && !contracts && !inbound && !outbound && !pendingTrucks) {
    return (
      <div className="kastros-desk-page">
        <PageLoadingSkeleton label="Loading truck movements…" rows={10} />
      </div>
    );
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
            <span className="text-muted-foreground">Truck Movements</span>
          </>
        }
        title="Truck Movements"
        subtitle="Inbound and outbound trucks — gate register, gatepass, and trade assignment."
        actions={
          <Link
            href="/warehouse/gatepass"
            target="_blank"
            className="kastros-btn-primary inline-flex items-center gap-2"
          >
            <ClipboardList className="h-4 w-4" />
            Gatepass link
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<Truck className="h-5 w-5" />} label="Vehicles Today" value={vehiclesToday} variant="accent" />
        <Kpi icon={<ArrowDownToLine className="h-5 w-5" />} label="Pending Gate In" value={pendingInbound} variant="success" />
        <Kpi icon={<ArrowUpFromLine className="h-5 w-5" />} label="Pending Gate Out" value={pendingOutbound} variant="info" />
        <Kpi icon={<Truck className="h-5 w-5" />} label="Awaiting Assignment" value={unassignedGatepassCount} variant="accent" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {unassignedGatepassCount > 0 && (
        <section className="exec-panel max-h-[38%] shrink-0 border-accent-secondary/30">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Truck className="h-4 w-4 text-accent-secondary" />
            Unassigned Gatepass Trucks
            <span className="rounded-full bg-accent-secondary-muted px-2 py-0.5 text-[10px] font-bold text-accent-secondary">
              {unassignedGatepassCount}
            </span>
          </h2>
          <div className="kastros-table-wrap max-h-full min-h-0 flex-1 overflow-auto border-0 shadow-none">
            <table className="kastros-table text-xs">
              <thead>
                <tr>
                  {["Type", "Gatepass", "Generated", "Truck", "Counterparty", "Commodity", "Builty", "Warehouse", "Weight", "Invoice", "Status", "Go to", "Actions"].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {unassignedPagination.items.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold",
                            t.movementType === "INBOUND" ? "exec-badge-local" : "exec-badge-intl",
                          )}
                        >
                          {t.movementType}
                        </span>
                      </td>
                      <td className="font-mono font-semibold text-accent-secondary">{t.gatepassNo}</td>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {fmtGatepassGenerated(t.arrivalDate)}
                      </td>
                      <td className="font-mono text-foreground">{t.truckNo}</td>
                      <td>
                        <div className="text-foreground">{t.counterpartyName}</div>
                      </td>
                      <td className="text-muted-foreground">{t.commodityName ?? "—"}</td>
                      <td className="max-w-[120px] truncate text-muted-foreground" title={t.builtyDetails ?? ""}>
                        {t.builtyDetails ?? "—"}
                      </td>
                      <td className="text-muted-foreground">{t.warehouseName}</td>
                      <td>
                        <div className="font-semibold text-accent-secondary">
                          {new Intl.NumberFormat("en-PK").format(t.remainingKg)} kg
                        </div>
                        {t.quantityBagsBales && <div className="text-subtle">{t.quantityBagsBales} bags/bales</div>}
                        {!t.quantityBagsBales && t.bags && <div className="text-subtle">{t.bags} bags</div>}
                      </td>
                      <td>
                        <GateInvoiceCell
                          movementType={t.movementType}
                          invoiceNo={t.assignedTradeRef ? t.gateInvoiceNo : null}
                          invoiceQtyMt={t.assignedTradeRef ? t.gateInvoiceQtyMt : null}
                          invoiceQtyUnit={t.gateInvoiceQtyMt != null ? "MT" : undefined}
                          invoiceAmount={t.assignedTradeRef ? t.gateInvoiceAmount : null}
                          invoiceCurrency={t.gateInvoiceCurrency}
                          pendingAssignment={!t.assignedTradeRef}
                        />
                      </td>
                      <td>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase",
                            t.status === "PARTIAL" ? "exec-badge-intl" : "exec-stat-accent text-accent-secondary",
                          )}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={
                            t.movementType === "INBOUND"
                              ? "/execution/purchase-delivered"
                              : "/execution/sales"
                          }
                          className="text-xs text-accent-secondary hover:underline"
                        >
                          Assign →
                        </Link>
                      </td>
                      <td>
                        <GateRegisterActions
                          entry={pendingTruckToRegisterEntry(t)}
                          compact
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <ListPagination
              page={unassignedPagination.page}
              totalPages={unassignedPagination.totalPages}
              totalItems={unassignedPagination.totalItems}
              startIndex={unassignedPagination.startIndex}
              endIndex={unassignedPagination.endIndex}
              onPageChange={unassignedPagination.setPage}
            />
          </div>
        </section>
      )}

      <section className="exec-panel flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Gate Register</h2>
            <p className="mt-0.5 text-xs text-subtle">
              All gate in/out slips — including unassigned gatepasses waiting for trade linkage.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search truck, gatepass, trade"
                className="kastros-input kastros-input-sm w-56 py-2 pl-8"
              />
            </div>
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="exec-filter kastros-select-sm"
            >
              {warehouseOptions.map((w) => (
                <option key={w} value={w}>
                  {w === "ALL" ? "All warehouses" : w}
                </option>
              ))}
            </select>
            <select
              value={commodityFilter}
              onChange={(e) => setCommodityFilter(e.target.value)}
              className="exec-filter kastros-select-sm"
            >
              <option value="ALL">All commodities</option>
              {commodityCodes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Segment value={movementFilter} onChange={setMovementFilter} />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="kastros-input kastros-input-sm"
              aria-label="From date"
            />
            <span className="text-xs text-subtle">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="kastros-input kastros-input-sm"
              aria-label="To date"
            />
            <button
              type="button"
              onClick={exportFilteredExcel}
              disabled={filteredMovements.length === 0}
              className="kastros-btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Excel ({filteredMovements.length})
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="kastros-table text-xs">
            <thead>
              <tr>
                {["Type", "Gatepass", "Generated", "Truck", "Trade", "Warehouse", "Weight", "Invoice", "Documents", "Status", "Actions"].map(
                  (h) => (
                  <th key={h} className="px-5">
                    {h}
                  </th>
                ),
                )}
              </tr>
            </thead>
            <tbody>
              {movementsPagination.items.map((m) => {
                const registerEntry = movementToRegisterEntry(
                  m,
                  pendingTruckById,
                  inboundById,
                  outboundById,
                );
                return (
                <tr key={`${m.type}-${m.id}`}>
                  <td className="px-5 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold",
                        m.type === "INBOUND" ? "exec-badge-local" : "exec-badge-intl",
                      )}
                    >
                      {m.type === "INBOUND" ? (
                        <ArrowDownToLine className="h-3 w-3" />
                      ) : (
                        <ArrowUpFromLine className="h-3 w-3" />
                      )}
                      {m.type === "INBOUND" ? "IN" : "OUT"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-mono font-semibold text-foreground">{m.gatepassNo}</div>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                    {fmtGatepassGenerated(m.date)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-mono text-foreground">{m.truckNo}</div>
                    {m.driverName && <div className="truncate text-subtle">{m.driverName}</div>}
                  </td>
                  <td className="px-5 py-3">
                    {m.isPendingGatepass || m.tradeRef === "—" ? (
                      <>
                        <span className="text-xs font-medium text-accent-secondary">Awaiting assignment</span>
                        <div className="text-subtle">
                          {m.commodityCode} · {m.counterpartyName}
                        </div>
                      </>
                    ) : (
                      <>
                        <Link
                          href={tradeHref(m.tradeRef, contractByRef.get(m.tradeRef)?.executionProfile)}
                          className="font-mono font-semibold text-accent-secondary hover:underline"
                        >
                          {m.tradeRef}
                        </Link>
                        <div className="text-subtle">
                          {m.commodityCode} · {m.counterpartyName}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{m.warehouseName}</td>
                  <td className="px-5 py-3">
                    <div className="font-semibold text-foreground">
                      {formatQtyWithUnit(m.netQtyMt, m.quantityUnit, 2)}
                    </div>
                    <div className="text-subtle">{fmtKg(m.grossWeightKg)}</div>
                  </td>
                  <td className="px-5 py-3">
                    <GateInvoiceCell
                      movementType={m.type}
                      invoiceNo={m.invoiceNo}
                      invoiceQtyMt={m.invoiceQtyMt}
                      invoiceQtyUnit={m.invoiceQtyUnit ?? undefined}
                      invoiceAmount={m.invoiceAmount}
                      invoiceCurrency={m.invoiceCurrency}
                      pendingAssignment={m.isPendingGatepass && !m.invoiceNo}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <GateDocumentsCell refs={m.documentRefs} />
                  </td>
                  <td className="px-5 py-3">
                    <Status status={m.status} />
                  </td>
                  <td className="px-5 py-3">
                    {registerEntry ? (
                      <GateRegisterActions entry={registerEntry} compact />
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {filteredMovements.length === 0 && <Empty label="No movements match the current filters" />}
          <ListPagination
            page={movementsPagination.page}
            totalPages={movementsPagination.totalPages}
            totalItems={movementsPagination.totalItems}
            startIndex={movementsPagination.startIndex}
            endIndex={movementsPagination.endIndex}
            onPageChange={movementsPagination.setPage}
          />
        </div>
      </section>
      </div>
    </div>
  );
}

function tradeHref(tradeRef: string, profile?: string) {
  const base =
    profile === "SALE_EX_WAREHOUSE"
      ? "/execution/sales"
      : profile === "PURCHASE_SPOT"
        ? "/execution/purchase-spot"
        : "/execution/purchase-delivered";
  return `${base}/${encodeURIComponent(tradeRef)}`;
}

function pendingTruckToRegisterEntry(
  t: PendingTruck,
): Extract<GateRegisterEntry, { kind: "pending" }> {
  return {
    kind: "pending",
    id: t.id,
    gatepassNo: t.gatepassNo,
    truckNo: t.truckNo,
    movementType: t.movementType,
    warehouseName: t.warehouseName,
    counterpartyName: t.counterpartyName,
    transporterName: t.transporterName ?? t.driverName,
    transporterPhone: t.transporterPhone ?? t.driverPhone,
    builtyDetails: t.builtyDetails,
    commodityCode: t.commodityCode,
    commodityName: t.commodityName,
    quantityAsPerBuilty: t.quantityAsPerBuilty,
    weightAsPerBuiltyKg: t.weightAsPerBuiltyKg,
    weighBridgeName: t.weighBridgeName,
    warehouseWeightKg: t.warehouseWeightKg,
    quantityBagsBales: t.quantityBagsBales,
    totalDeductionsKg: t.totalDeductionsKg,
    weightKg: t.remainingKg,
    bags: t.bags,
    remarks: t.remarks,
    status: t.status,
    generatedAt: t.arrivalDate,
    gateInvoiceNo: t.gateInvoiceNo,
    gateInvoiceWeightKg: t.gateInvoiceWeightKg,
    gateInvoiceQtyMt: t.gateInvoiceQtyMt,
    gateInvoiceAmount: t.gateInvoiceAmount,
    gateInvoiceCurrency: t.gateInvoiceCurrency,
    gateInvoiceTradeRef: t.gateInvoiceTradeRef,
  };
}

function movementToRegisterEntry(
  m: Movement,
  pendingTruckById: Map<string, PendingTruck>,
  inboundById: Map<string, InboundReceipt>,
  outboundById: Map<string, OutboundDispatch>,
): GateRegisterEntry | null {
  if (m.sourceKind === "pending") {
    const t = pendingTruckById.get(m.sourceId);
    if (!t) return null;
    return pendingTruckToRegisterEntry(t);
  }
  if (m.sourceKind === "inbound") {
    const r = inboundById.get(m.sourceId);
    if (!r) return null;
    return {
      kind: "inbound",
      id: r.id,
      gatepassNo: r.gatepassNo ?? r.kcsNo,
      truckNo: r.truckNo,
      tradeRef: r.tradeRef,
      warehouseName: r.warehouseName,
      counterpartyName: r.sellerName,
      weightKg: r.weightWarehouseKg,
      bags: r.bags,
      driverName: r.driverName,
      driverPhone: r.driverPhone,
      builtyDetails: r.biltyNo,
      remarks: r.remarks,
      generatedAt: r.receiveDate,
      gateInvoiceNo: r.billNo,
      gateInvoiceQtyMt: r.allocatedQtyMt,
      gateInvoiceAmount: r.amountDue,
      gateInvoiceCurrency: m.invoiceCurrency ?? null,
    };
  }
  const d = outboundById.get(m.sourceId);
  if (!d) return null;
  return {
    kind: "outbound",
    id: d.id,
    gatepassNo: d.gatepassNo ?? d.doRef ?? d.id,
    truckNo: d.truckNo,
    tradeRef: d.tradeRef,
    warehouseName: d.warehouseName,
    counterpartyName: d.buyerName,
    weightKg: d.dispatchWeightKg,
    driverName: d.driverName,
    driverPhone: d.driverPhone,
    doRef: d.doRef,
    remarks: d.remarks,
    generatedAt: d.dispatchDate,
  };
}

type KpiVariant = "accent" | "success" | "info";

function Kpi({
  icon,
  label,
  value,
  variant,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  variant: KpiVariant;
}) {
  const shell = {
    accent: "exec-stat exec-stat-accent",
    success: "exec-stat exec-stat-success",
    info: "exec-stat exec-stat-info",
  }[variant];
  const valueClass = {
    accent: "exec-stat-value-accent",
    success: "exec-stat-value-success",
    info: "exec-stat-value-info",
  }[variant];

  return (
    <div className={cn(shell, "p-4 text-left")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-subtle">{label}</div>
          <div className={cn("mt-1 text-2xl font-bold tabular-nums", valueClass)}>{value}</div>
        </div>
        <div className={cn("rounded-xl p-2", valueClass)}>{icon}</div>
      </div>
    </div>
  );
}

function Segment({
  value,
  onChange,
}: {
  value: "ALL" | "INBOUND" | "OUTBOUND";
  onChange: (value: "ALL" | "INBOUND" | "OUTBOUND") => void;
}) {
  return (
    <div className="exec-segment">
      {(["ALL", "INBOUND", "OUTBOUND"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn("exec-segment-item", value === v && "exec-segment-active")}
        >
          {v === "ALL" ? "All" : v === "INBOUND" ? "Inbound" : "Outbound"}
        </button>
      ))}
    </div>
  );
}

function Status({ status }: { status: string }) {
  const released = status === "RELEASED" || status === "PAID" || status === "ALLOCATED";
  const pending = status.includes("PENDING") || status === "WEIGHED" || status.startsWith("GATEPASS");
  const cls = released ? "exec-badge-open" : pending ? "exec-stat-accent text-accent-secondary" : "exec-badge-intl";
  return (
    <span className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase", cls)}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function GateDocumentsCell({ refs }: { refs: string[] }) {
  if (!refs.length) {
    return <span className="text-subtle">—</span>;
  }
  return (
    <ul className="max-w-[220px] space-y-0.5 text-muted-foreground">
      {refs.map((ref) => (
        <li key={ref} className="truncate" title={gatepassDocumentDisplayName(ref)}>
          {gatepassDocumentDisplayName(ref)}
        </li>
      ))}
    </ul>
  );
}

function GateInvoiceCell({
  movementType,
  invoiceNo,
  invoiceQtyMt,
  invoiceQtyUnit,
  invoiceAmount,
  invoiceCurrency,
  pendingAssignment,
}: {
  movementType: "INBOUND" | "OUTBOUND";
  invoiceNo?: string | null;
  invoiceQtyMt?: number | null;
  invoiceQtyUnit?: string;
  invoiceAmount?: number | null;
  invoiceCurrency?: string | null;
  pendingAssignment?: boolean;
}) {
  if (movementType !== "INBOUND") {
    return <span className="text-subtle">—</span>;
  }
  if (pendingAssignment && !invoiceNo) {
    return <span className="text-subtle">After trade assignment</span>;
  }
  if (!invoiceNo) {
    return <span className="text-subtle">—</span>;
  }
  return (
    <div className="space-y-0.5">
      <div className="font-mono text-[11px] font-semibold text-foreground">{invoiceNo}</div>
      {invoiceQtyMt != null && (
        <div className="text-subtle">{formatQtyWithUnit(invoiceQtyMt, invoiceQtyUnit ?? "MT", 3)}</div>
      )}
      {invoiceAmount != null && (
        <div className="font-medium text-accent-secondary">
          {formatCurrency(invoiceAmount, invoiceCurrency ?? "PKR")}
        </div>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <Truck className="mb-2 h-8 w-8 text-subtle" />
      <p className="text-sm text-subtle">{label}</p>
    </div>
  );
}

"use client";

import { trpc } from "@/lib/trpc/client";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { summarizeQtyByUnit } from "@/lib/formatters/execution-units";
import {
  aggregateWarehouseStock,
  warehouseUtilizationSummary,
} from "@/lib/warehouse-utilization";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  Download,
  ExternalLink,
  Search,
  Truck,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

const fmtKg = (n: number) =>
  `${new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 }).format(n)} kg`;

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
  stockDeltaMt: number;
  status: string;
  driverName?: string | null;
  remarks?: string | null;
  isPendingGatepass?: boolean;
};

const INV_REFETCH_MS = 8000;

export default function ExecutionInventoryPage() {
  const { data: contracts, isLoading: loadingContracts } = trpc.execution.lockedContracts.useQuery({});
  const { data: warehouseLocations } = trpc.execution.warehouseLocations.useQuery();
  const { data: inbound, isLoading: loadingInbound } = trpc.execution.inboundReceipts.useQuery({});
  const { data: outbound, isLoading: loadingOutbound } = trpc.execution.outboundDispatches.useQuery({});
  const { data: pendingTrucks } = trpc.execution.pendingTrucks.useQuery(
    {},
    { refetchInterval: INV_REFETCH_MS, refetchOnWindowFocus: true },
  );
  const exportCsvMutation = trpc.execution.exportMovementsCsv.useMutation();

  const [warehouseFilter, setWarehouseFilter] = useState("ALL");
  const [commodityFilter, setCommodityFilter] = useState("ALL");
  const [movementFilter, setMovementFilter] = useState<"ALL" | "INBOUND" | "OUTBOUND">("ALL");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  function handleDownloadCsv(period: "today" | "month" | "custom") {
    const now = new Date();
    let from: Date | undefined;
    let to: Date | undefined;
    if (period === "today") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (period === "month") {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else {
      from = dateFrom ? new Date(dateFrom) : undefined;
      to = dateTo ? new Date(dateTo + "T23:59:59") : undefined;
    }
    exportCsvMutation.mutate(
      {
        warehouseName: warehouseFilter !== "ALL" ? warehouseFilter : undefined,
        commodityCode: commodityFilter !== "ALL" ? commodityFilter : undefined,
        movementType: movementFilter !== "ALL" ? movementFilter : "ALL",
        from,
        to,
      },
      {
        onSuccess: (data) => {
          const blob = new Blob([data.csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = data.filename;
          a.click();
          URL.revokeObjectURL(url);
        },
      },
    );
  }

  const contractByRef = useMemo(
    () => new Map((contracts ?? []).map((c) => [c.tradeRef, c])),
    [contracts],
  );

  const warehouseConfigByName = useMemo(
    () => new Map((warehouseLocations ?? []).map((w) => [w.name, w])),
    [warehouseLocations],
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
        documentRefs: r.documentRefs?.length
          ? r.documentRefs
          : [r.kcsNo, r.biltyNo, r.trnNo, r.billNo ?? ""].filter(Boolean),
        grossWeightKg: r.weightWarehouseKg,
        netQtyMt: r.allocatedQtyMt,
        stockDeltaMt: r.status === "DRAFT" ? 0 : r.allocatedQtyMt,
        status: r.status,
        driverName: r.driverName,
        remarks: r.remarks,
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
        documentRefs: d.documentRefs?.length ? d.documentRefs : [d.doRef ?? ""].filter(Boolean),
        grossWeightKg: d.dispatchWeightKg,
        netQtyMt: d.allocatedQtyMt,
        stockDeltaMt: d.status === "RELEASED" ? -d.allocatedQtyMt : 0,
        status: d.status,
        driverName: d.driverName,
        remarks: d.remarks,
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
        documentRefs: [t.builtyDetails, t.gatepassNo].filter((x): x is string => Boolean(x)),
        grossWeightKg: t.remainingKg,
        netQtyMt: t.remainingKg,
        stockDeltaMt: 0,
        status: t.status === "PARTIAL" ? "GATEPASS_PARTIAL" : "GATEPASS_PENDING",
        driverName: t.driverName,
        remarks: t.remarks,
        isPendingGatepass: true,
      }));

    return [...pendingRows, ...inboundRows, ...outboundRows].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [contractByRef, inbound, outbound, pendingTrucks]);

  const warehouses = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        netMt: number;
        inboundMt: number;
        outboundMt: number;
        inboundTrucks: number;
        outboundTrucks: number;
        pendingInbound: number;
        pendingOutbound: number;
        commodities: Map<string, { code: string; unit: string; qty: number }>;
      }
    >();

    for (const m of movements) {
      const row =
        map.get(m.warehouseName) ??
        {
          name: m.warehouseName,
          netMt: 0,
          inboundMt: 0,
          outboundMt: 0,
          inboundTrucks: 0,
          outboundTrucks: 0,
          pendingInbound: 0,
          pendingOutbound: 0,
          commodities: new Map<string, { code: string; unit: string; qty: number }>(),
        };

      row.netMt += m.stockDeltaMt;
      const commodityKey = `${m.commodityCode}|${m.quantityUnit}`;
      const commodity = row.commodities.get(commodityKey) ?? {
        code: m.commodityCode,
        unit: m.quantityUnit,
        qty: 0,
      };
      commodity.qty += m.stockDeltaMt;
      row.commodities.set(commodityKey, commodity);
      if (m.type === "INBOUND") {
        row.inboundMt += m.stockDeltaMt;
        row.inboundTrucks += 1;
      } else {
        row.outboundMt += m.status === "RELEASED" ? m.netQtyMt : 0;
        row.outboundTrucks += 1;
        if (m.status !== "RELEASED") row.pendingOutbound += 1;
      }

      map.set(m.warehouseName, row);
    }

    for (const t of pendingTrucks ?? []) {
      if (t.status === "ASSIGNED") continue;
      const row =
        map.get(t.warehouseName) ??
        {
          name: t.warehouseName,
          netMt: 0,
          inboundMt: 0,
          outboundMt: 0,
          inboundTrucks: 0,
          outboundTrucks: 0,
          pendingInbound: 0,
          pendingOutbound: 0,
          commodities: new Map<string, { code: string; unit: string; qty: number }>(),
        };
      if (t.movementType === "INBOUND") row.pendingInbound += 1;
      else row.pendingOutbound += 1;
      map.set(t.warehouseName, row);
    }

    return Array.from(map.values()).sort((a, b) => b.netMt - a.netMt);
  }, [movements, pendingTrucks]);

  const warehouseOptions = useMemo(
    () => ["ALL", ...warehouses.map((w) => w.name)],
    [warehouses],
  );

  const locationCommodityRows = useMemo(() => {
    const map = new Map<
      string,
      {
        warehouseName: string;
        commodityCode: string;
        commodityName: string;
        quantityUnit: string;
        inboundQty: number;
        outboundQty: number;
        netQty: number;
        trucks: number;
      }
    >();

    for (const m of movements) {
      const key = `${m.warehouseName}|${m.commodityCode}|${m.quantityUnit}`;
      const row =
        map.get(key) ??
        {
          warehouseName: m.warehouseName,
          commodityCode: m.commodityCode,
          commodityName: m.commodityName,
          quantityUnit: m.quantityUnit,
          inboundQty: 0,
          outboundQty: 0,
          netQty: 0,
          trucks: 0,
        };

      row.trucks += 1;
      if (m.type === "INBOUND" && m.status !== "DRAFT") row.inboundQty += m.netQtyMt;
      if (m.type === "OUTBOUND" && m.status === "RELEASED") row.outboundQty += m.netQtyMt;
      row.netQty += m.stockDeltaMt;
      map.set(key, row);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.warehouseName.localeCompare(b.warehouseName) || a.commodityCode.localeCompare(b.commodityCode),
    );
  }, [movements]);

  const commodityCodes = useMemo(() => {
    const codes = new Set<string>();
    movements.forEach((m) => { if (m.commodityCode !== "-") codes.add(m.commodityCode); });
    return Array.from(codes).sort();
  }, [movements]);

  const filteredMovements = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom) : null;
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null;
    return movements.filter((m) => {
      if (warehouseFilter !== "ALL" && m.warehouseName !== warehouseFilter) return false;
      if (commodityFilter !== "ALL" && m.commodityCode !== commodityFilter) return false;
      if (movementFilter !== "ALL" && m.type !== movementFilter) return false;
      if (from && new Date(m.date) < from) return false;
      if (to && new Date(m.date) > to) return false;
      if (!q) return true;
      return [
        m.tradeRef, m.warehouseName, m.truckNo, m.gatepassNo,
        m.counterpartyName, m.commodityCode, m.driverName ?? "", ...m.documentRefs,
      ].join(" ").toLowerCase().includes(q);
    });
  }, [movementFilter, movements, query, warehouseFilter, commodityFilter, dateFrom, dateTo]);

  const openContracts = useMemo(
    () => (contracts ?? []).filter((c) => c.contractStatus === "Open"),
    [contracts],
  );

  const totalStockLabel = useMemo(() => {
    const items: { qty: number; unit: string }[] = [];
    for (const w of warehouses) {
      for (const c of w.commodities.values()) {
        if (Math.abs(c.qty) > 0.001) items.push({ qty: c.qty, unit: c.unit });
      }
    }
    return summarizeQtyByUnit(items, 2);
  }, [warehouses]);
  const today = new Date().toDateString();
  const vehiclesToday = movements.filter((m) => new Date(m.date).toDateString() === today).length;
  const pendingInbound =
    (pendingTrucks ?? []).filter((t) => t.movementType === "INBOUND" && t.status !== "ASSIGNED").length +
    movements.filter((m) => m.type === "INBOUND" && !m.isPendingGatepass && m.status === "DRAFT").length;
  const pendingOutbound =
    (pendingTrucks ?? []).filter((t) => t.movementType === "OUTBOUND" && t.status !== "ASSIGNED").length +
    movements.filter((m) => m.type === "OUTBOUND" && !m.isPendingGatepass && m.status !== "RELEASED").length;
  const unassignedGatepassCount = (pendingTrucks ?? []).filter((t) => t.status !== "ASSIGNED").length;
  const loading = loadingContracts || loadingInbound || loadingOutbound;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs" style={{ color: "#71717a" }}>
            <Link href="/execution" className="hover:text-white">Desk</Link>
            <span>/</span>
            <span style={{ color: "#a1a1aa" }}>Inventory</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white">Inventory Management</h1>
          <p className="mt-1 text-sm" style={{ color: "#71717a" }}>
            Warehouse stock, truck gatepasses, and trade fulfillment in one view.
          </p>
        </div>
        <Link
          href="/warehouse/gatepass"
          target="_blank"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#f59e0b,#fbbf24)" }}
        >
          <ClipboardList className="h-4 w-4" />
          Gatepass link
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi icon={<Warehouse className="h-5 w-5" />} label="Net movement qty" value={totalStockLabel || "0"} color="#f59e0b" />
        <Kpi icon={<Truck className="h-5 w-5" />} label="Vehicles Today" value={vehiclesToday} color="#fb923c" />
        <Kpi icon={<ArrowDownToLine className="h-5 w-5" />} label="Pending Gate In" value={pendingInbound} color="#34d399" />
        <Kpi icon={<ArrowUpFromLine className="h-5 w-5" />} label="Pending Gate Out" value={pendingOutbound} color="#a78bfa" />
        <Kpi
          icon={<Truck className="h-5 w-5" />}
          label="Awaiting Assignment"
          value={unassignedGatepassCount}
          color="#f59e0b"
        />
      </div>

      {unassignedGatepassCount > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Truck className="h-4 w-4 text-amber-400" />
            Unassigned Gatepass Trucks
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
              {(pendingTrucks ?? []).filter((t) => t.status !== "ASSIGNED").length}
            </span>
          </h2>
          <div className="overflow-x-auto rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(245,158,11,0.15)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Type", "Gatepass", "Truck", "Counterparty", "Commodity", "Builty", "Warehouse", "Weight", "Status", "Go to"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left font-medium uppercase tracking-wider" style={{ color: "#52525b" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(pendingTrucks ?? []).filter((t) => t.status !== "ASSIGNED").map((t, i, arr) => (
                  <tr key={t.id} style={{ borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: t.movementType === "INBOUND" ? "rgba(52,211,153,0.12)" : "rgba(167,139,250,0.12)", color: t.movementType === "INBOUND" ? "#34d399" : "#a78bfa" }}>
                        {t.movementType}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-amber-400">{t.gatepassNo}</td>
                    <td className="px-4 py-2.5 font-mono text-zinc-200">{t.truckNo}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-white">{t.counterpartyName}</div>
                      {t.brokerName && <div className="text-zinc-500">via {t.brokerName}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-300">{t.commodityName ?? "—"}</td>
                    <td className="px-4 py-2.5 max-w-[120px] truncate text-zinc-400" title={t.builtyDetails ?? ""}>
                      {t.builtyDetails ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-300">{t.warehouseName}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-amber-400">{new Intl.NumberFormat("en-PK").format(t.remainingKg)} kg</div>
                      {t.bags && <div className="text-zinc-500">{t.bags} bags</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase" style={{
                        background: t.status === "PARTIAL" ? "rgba(96,165,250,0.15)" : "rgba(245,158,11,0.15)",
                        color: t.status === "PARTIAL" ? "#60a5fa" : "#f59e0b",
                      }}>{t.status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={t.movementType === "INBOUND" ? "/execution/purchase-delivered" : "/execution/sales"} className="text-xs text-amber-400 hover:underline">
                        Assign →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Warehouse Balances</h2>
          <div className="flex items-center gap-3">
            <Link href="/execution/warehouses" className="text-xs font-medium text-amber-400 hover:underline">
              Setup capacity
            </Link>
            <span className="text-xs" style={{ color: "#71717a" }}>{warehouses.length} warehouse{warehouses.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {warehouses.map((w) => (
            <div
              key={w.name}
              className="rounded-2xl p-4"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Warehouse className="h-4 w-4 text-amber-400" />
                    <h3 className="truncate text-sm font-semibold text-white">{w.name}</h3>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "#71717a" }}>
                    {w.inboundTrucks} received · {w.pendingInbound} gate in waiting · {w.outboundTrucks} released ·{" "}
                    {w.pendingOutbound} gate out waiting
                  </p>
                </div>
                <div className="text-right">
                  {(() => {
                    const units = new Set(Array.from(w.commodities.values()).map((c) => c.unit));
                    const netLabel =
                      units.size === 1
                        ? formatQtyWithUnit(w.netMt, [...units][0] ?? "MT", 2)
                        : summarizeQtyByUnit(
                            [...w.commodities.values()]
                              .filter((c) => Math.abs(c.qty) > 0.001)
                              .map((c) => ({ qty: c.qty, unit: c.unit })),
                            2,
                          ) || "—";
                    return (
                      <>
                        <div className="text-lg font-bold tabular-nums text-amber-400">{netLabel}</div>
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: "#52525b" }}>
                          net by unit
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Mini label="Inbound trucks" value={String(w.inboundTrucks)} color="#34d399" />
                <Mini label="Released outbound trucks" value={String(w.outboundTrucks)} color="#a78bfa" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Array.from(w.commodities.values())
                  .filter((c) => Math.abs(c.qty) > 0.001)
                  .slice(0, 5)
                  .map((c) => (
                    <span
                      key={`${c.code}-${c.unit}`}
                      className="rounded-full px-2 py-1 text-[10px] font-semibold"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#d4d4d8" }}
                    >
                      {c.code}: {formatQtyWithUnit(c.qty, c.unit, 2)}
                    </span>
                  ))}
              </div>
              {(() => {
                const cfg = warehouseConfigByName.get(w.name);
                const capSqFt = cfg?.capacitySqFt ?? 0;
                if (!capSqFt) return null;
                const capacity = {
                  capacitySqFt: capSqFt,
                  balesDivisionSqFt: cfg?.balesDivisionSqFt ?? 4.5,
                  grainDivisionSqFt: cfg?.grainDivisionSqFt ?? 7,
                };
                const stock = aggregateWarehouseStock(
                  [...w.commodities.values()].map((c) => ({
                    commodityCode: c.code,
                    quantityUnit: c.unit,
                    netQty: c.qty,
                  })),
                );
                const util = warehouseUtilizationSummary(stock, capacity);
                return (
                  <div className="mt-3 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)" }}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Sq ft utilization (shared)</span>
                      <span className="font-semibold text-zinc-300">{(util.utilizationPct * 100).toFixed(1)}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(util.utilizationPct * 100, 100)}%`,
                          background:
                            util.utilizationPct > 0.9
                              ? "#f87171"
                              : util.utilizationPct > 0.75
                                ? "#fbbf24"
                                : "#34d399",
                        }}
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] text-zinc-600">
                      {util.consumedSqFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} /{" "}
                      {capSqFt.toLocaleString()} sq ft used · room for{" "}
                      {util.balanceMt.toFixed(0)} MT or {util.balanceBales.toFixed(0)} bales more
                    </p>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
        {!loading && warehouses.length === 0 && (
          <Empty label="No warehouse movements yet" />
        )}
      </section>

      <section className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-sm font-semibold text-white">Inventory by Location & Commodity</h2>
          <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
            Split by warehouse, commodity, and the unit booked on the linked trade.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {["Warehouse", "Commodity", "Unit", "Inbound", "Released Outbound", "Net", "Trucks"].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left font-medium uppercase tracking-wider" style={{ color: "#52525b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {locationCommodityRows.map((row, i) => (
                <tr
                  key={`${row.warehouseName}-${row.commodityCode}-${row.quantityUnit}`}
                  className="hover:bg-white/[0.02]"
                  style={{ borderBottom: i < locationCommodityRows.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }}
                >
                  <td className="px-5 py-3 text-zinc-300">{row.warehouseName}</td>
                  <td className="px-5 py-3">
                    <div className="font-semibold text-white">{row.commodityCode}</div>
                    <div style={{ color: "#71717a" }}>{row.commodityName}</div>
                  </td>
                  <td className="px-5 py-3 text-zinc-400">{row.quantityUnit}</td>
                  <td className="px-5 py-3 tabular-nums text-emerald-400">{formatQtyWithUnit(row.inboundQty, row.quantityUnit, 2)}</td>
                  <td className="px-5 py-3 tabular-nums text-purple-300">{formatQtyWithUnit(row.outboundQty, row.quantityUnit, 2)}</td>
                  <td className="px-5 py-3 tabular-nums font-semibold text-amber-400">{formatQtyWithUnit(row.netQty, row.quantityUnit, 2)}</td>
                  <td className="px-5 py-3 tabular-nums text-zinc-400">{row.trucks}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && locationCommodityRows.length === 0 && <Empty label="No commodity/location stock split yet" />}
        </div>
      </section>

      <section className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <div>
            <h2 className="text-sm font-semibold text-white">Truck Movements</h2>
            <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
              All gate in/out slips — including unassigned gatepasses waiting for trade linkage.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search trade, truck, gatepass"
                className="w-56 rounded-xl py-2 pl-8 pr-3 text-xs text-white outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              />
            </div>
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs text-white outline-none"
              style={{ background: "#111318", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {warehouseOptions.map((w) => (
                <option key={w} value={w}>{w === "ALL" ? "All warehouses" : w}</option>
              ))}
            </select>
            <select
              value={commodityFilter}
              onChange={(e) => setCommodityFilter(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs text-white outline-none"
              style={{ background: "#111318", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <option value="ALL">All commodities</option>
              {commodityCodes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Segment value={movementFilter} onChange={setMovementFilter} />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs text-white outline-none"
              style={{ background: "#111318", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
            />
            <span className="text-xs text-zinc-600">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-xl px-3 py-2 text-xs text-white outline-none"
              style={{ background: "#111318", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
            />
            <button
              type="button"
              onClick={() => handleDownloadCsv("today")}
              disabled={exportCsvMutation.isPending}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)" }}
              title="Export today's movements as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Today
            </button>
            <button
              type="button"
              onClick={() => handleDownloadCsv("month")}
              disabled={exportCsvMutation.isPending}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}
              title="Export this month's movements as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Month
            </button>
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => handleDownloadCsv("custom")}
                disabled={exportCsvMutation.isPending}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)" }}
                title="Export filtered date range as CSV"
              >
                <Download className="h-3.5 w-3.5" />
                Range
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {["Type", "Gatepass", "Truck", "Trade", "Warehouse", "Weight", "Documents", "Status"].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left font-medium uppercase tracking-wider" style={{ color: "#52525b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMovements.map((m, i) => (
                <tr
                  key={`${m.type}-${m.id}`}
                  style={{ borderBottom: i < filteredMovements.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined }}
                  className="hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-3">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold"
                      style={{
                        background: m.type === "INBOUND" ? "rgba(52,211,153,0.12)" : "rgba(167,139,250,0.12)",
                        color: m.type === "INBOUND" ? "#34d399" : "#a78bfa",
                      }}
                    >
                      {m.type === "INBOUND" ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}
                      {m.type === "INBOUND" ? "IN" : "OUT"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-mono font-semibold text-white">{m.gatepassNo}</div>
                    <div style={{ color: "#71717a" }}>{new Date(m.date).toLocaleDateString("en-PK")}</div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-mono text-zinc-200">{m.truckNo}</div>
                    {m.driverName && <div className="truncate" style={{ color: "#71717a" }}>{m.driverName}</div>}
                  </td>
                  <td className="px-5 py-3">
                    {m.isPendingGatepass || m.tradeRef === "—" ? (
                      <>
                        <span className="text-xs font-medium text-amber-400">Awaiting assignment</span>
                        <div style={{ color: "#71717a" }}>
                          {m.commodityCode} · {m.counterpartyName}
                        </div>
                      </>
                    ) : (
                      <>
                        <Link
                          href={tradeHref(m.tradeRef, contractByRef.get(m.tradeRef)?.executionProfile)}
                          className="font-mono font-semibold text-amber-400 hover:underline"
                        >
                          {m.tradeRef}
                        </Link>
                        <div style={{ color: "#71717a" }}>
                          {m.commodityCode} · {m.counterpartyName}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-5 py-3 text-zinc-300">{m.warehouseName}</td>
                  <td className="px-5 py-3">
                    <div className="font-semibold text-white">{formatQtyWithUnit(m.netQtyMt, m.quantityUnit, 2)}</div>
                    <div style={{ color: "#71717a" }}>{fmtKg(m.grossWeightKg)}</div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="max-w-[220px] truncate text-zinc-400">
                      {m.documentRefs.length ? m.documentRefs.join(" · ") : "-"}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Status status={m.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredMovements.length === 0 && (
            <Empty label="No movements match the current filters" />
          )}
        </div>
      </section>

      <section className="rounded-2xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="border-b px-5 py-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-sm font-semibold text-white">Open Trade Completion</h2>
          <p className="mt-0.5 text-xs" style={{ color: "#71717a" }}>
            Locked trades close automatically as linked trucks are received or released.
          </p>
        </div>
        <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
          {openContracts.slice(0, 12).map((c) => {
            const pct = c.contractualQtyMt > 0 ? Math.min(c.receivedQtyMt / c.contractualQtyMt, 1) : 0;
            return (
              <div key={c.tradeRef} className="grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_240px_120px] md:items-center">
                <div className="min-w-0">
                  <Link href={tradeHref(c.tradeRef, c.executionProfile)} className="font-mono text-xs font-bold text-amber-400 hover:underline">
                    {c.tradeRef}
                  </Link>
                  <div className="mt-0.5 truncate text-sm text-white">{c.counterpartyName}</div>
                  <div className="text-xs" style={{ color: "#71717a" }}>{c.commodityCode} · {c.executionProfile.replace(/_/g, " ")}</div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[10px]" style={{ color: "#71717a" }}>
                    <span>{formatQtyWithUnit(c.receivedQtyMt, c.quantityUnit, 2)} moved</span>
                    <span>{(pct * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: "#f59e0b" }} />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-white">{formatQtyWithUnit(c.openQtyMt, c.quantityUnit, 2)}</div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "#52525b" }}>remaining</div>
                </div>
              </div>
            );
          })}
          {!loading && openContracts.length === 0 && <Empty label="No open locked trades" />}
        </div>
      </section>
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

function Kpi({ icon, label, value, color }: { icon: ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider" style={{ color: "#71717a" }}>{label}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
        </div>
        <div className="rounded-xl p-2" style={{ background: `${color}22`, color }}>{icon}</div>
      </div>
    </div>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: `${color}10`, border: `1px solid ${color}20` }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "#71717a" }}>{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ color }}>{value}</div>
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
    <div className="flex rounded-xl p-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      {(["ALL", "INBOUND", "OUTBOUND"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
          style={{
            background: value === v ? "rgba(245,158,11,0.16)" : "transparent",
            color: value === v ? "#f59e0b" : "#a1a1aa",
          }}
        >
          {v === "ALL" ? "All" : v === "INBOUND" ? "Inbound" : "Outbound"}
        </button>
      ))}
    </div>
  );
}

function Status({ status }: { status: string }) {
  const released = status === "RELEASED" || status === "PAID" || status === "ALLOCATED";
  const pending =
    status.includes("PENDING") || status === "WEIGHED" || status.startsWith("GATEPASS");
  const color = released ? "#34d399" : pending ? "#f59e0b" : "#a78bfa";
  return (
    <span className="rounded-full px-2 py-1 text-[10px] font-bold uppercase" style={{ background: `${color}18`, color }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <Truck className="mb-2 h-8 w-8 text-zinc-700" />
      <p className="text-sm text-zinc-500">{label}</p>
    </div>
  );
}

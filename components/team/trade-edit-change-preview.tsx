"use client";

import {
  buildTradeEditPreviewRows,
  countChangedRows,
  type PreviewRow,
} from "@/lib/change-request-trade-preview";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { WarehouseStorageMetricsPreview } from "@/components/execution/warehouse-storage-metrics-preview";

export function TradeEditChangePreview({
  tradeRef,
  payload,
  compact,
  useCeoLookup,
}: {
  tradeRef: string;
  payload: Record<string, unknown>;
  compact?: boolean;
  /** When true, fall back to CEO global trade lookup (drafts not yet with execution). */
  useCeoLookup?: boolean;
}) {
  const { data: openCurrent, isLoading: openLoading } = trpc.execution.openTradeByRef.useQuery(
    { tradeRef },
    { retry: false, enabled: !useCeoLookup },
  );
  const { data: lockedCurrent, isLoading: lockedLoading } = trpc.execution.lockedTradeByRef.useQuery(
    { tradeRef },
    { retry: false, enabled: !useCeoLookup },
  );
  const { data: ceoCurrent, isLoading: ceoLoading } = trpc.ceo.tradeByRefForPreview.useQuery(
    { tradeRef },
    { retry: false, enabled: useCeoLookup === true },
  );
  const current = useCeoLookup ? ceoCurrent : openCurrent ?? lockedCurrent;
  const isLoading = useCeoLookup ? ceoLoading : !current && (openLoading || lockedLoading);

  const rows = buildTradeEditPreviewRows(current ?? null, payload);
  const changedCount = countChangedRows(rows);
  const changedRows = rows.filter((r) => r.changed);
  const displayRows = compact && changedCount > 0 ? changedRows : rows;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-kastros-border/70 bg-black/15 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-foreground">Proposed trade changes</div>
        <div className="flex items-center gap-2 text-[10px] text-subtle">
          {isLoading ? (
            <span>Loading current trade…</span>
          ) : current ? (
            <>
              <span>
                {changedCount} field{changedCount !== 1 ? "s" : ""} changed
              </span>
              <Link
                href={`/execution/open-trades/${encodeURIComponent(tradeRef)}`}
                className="font-medium text-accent-secondary hover:underline"
              >
                Open trade →
              </Link>
            </>
          ) : (
            <span>Current trade not in Unreviewed Trades — showing proposed values only</span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-kastros-border/60 text-subtle">
              <th className="py-1.5 pr-3 font-medium">Field</th>
              <th className="py-1.5 pr-3 font-medium">Current</th>
              <th className="py-1.5 font-medium">Requested</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <PreviewRowView key={r.label} row={r} />
            ))}
          </tbody>
        </table>
      </div>

      {compact && changedCount > 0 && changedCount < rows.length && (
        <p className="text-[10px] text-subtle">
          Showing {changedCount} changed field{changedCount !== 1 ? "s" : ""} only. Approve applies the full
          proposed trade snapshot above.
        </p>
      )}
    </div>
  );
}

function PreviewRowView({ row }: { row: PreviewRow }) {
  return (
    <tr
      className={cn(
        "border-b border-kastros-border/40 last:border-0",
        row.changed && "bg-warning/[0.06]",
      )}
    >
      <td className="py-2 pr-3 align-top font-medium text-muted-foreground">{row.label}</td>
      <td className="py-2 pr-3 align-top text-subtle">{row.before}</td>
      <td className={cn("py-2 align-top", row.changed ? "font-medium text-foreground" : "text-muted-foreground")}>
        {row.after}
        {row.changed && (
          <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-warning">
            Changed
          </span>
        )}
      </td>
    </tr>
  );
}

/** Generic key-value preview for non-trade payloads. */
export function GenericPayloadPreview({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return null;

  return (
    <div className="mt-2 rounded border border-kastros-border/60 bg-black/20 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">Requested changes</div>
      <dl className="grid gap-1 text-[11px] sm:grid-cols-2">
        {entries.map(([key, val]) => (
          <div key={key} className="contents">
            <dt className="text-subtle">{key.replace(/_/g, " ")}</dt>
            <dd className="text-muted-foreground">
              {typeof val === "object" ? JSON.stringify(val) : String(val)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CommodityCreatePreview({ payload }: { payload: Record<string, unknown> }) {
  const name = String(payload.name ?? "");
  const code = String(payload.code ?? "");
  const unit = String(payload.unit ?? "");
  const category = payload.category ? String(payload.category) : null;
  const priceUnits = payload.priceUnits as
    | { LOCAL?: { currency: string; weightUnit: string; kgPerUnit: number }; INTERNATIONAL?: { currency: string; weightUnit: string; kgPerUnit: number } }
    | undefined;
  const params = payload.tradeParameterDefs as { label: string; group: string }[] | undefined;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-kastros-border/70 bg-black/15 p-3">
      <div className="text-xs font-semibold text-foreground">Proposed commodity registration</div>
      <dl className="grid gap-1.5 text-[11px] sm:grid-cols-2">
        <div>
          <dt className="text-subtle">Code</dt>
          <dd className="font-mono font-medium text-foreground">{code || "—"}</dd>
        </div>
        <div>
          <dt className="text-subtle">Name</dt>
          <dd className="text-muted-foreground">{name || "—"}</dd>
        </div>
        <div>
          <dt className="text-subtle">Quantity unit</dt>
          <dd className="text-muted-foreground">{unit || "—"}</dd>
        </div>
        {category && (
          <div>
            <dt className="text-subtle">Category</dt>
            <dd className="text-muted-foreground">{category}</dd>
          </div>
        )}
        {priceUnits?.LOCAL && (
          <div className="sm:col-span-2">
            <dt className="text-subtle">Local price metric</dt>
            <dd className="text-muted-foreground">
              {priceUnits.LOCAL.currency} / {priceUnits.LOCAL.weightUnit} ({priceUnits.LOCAL.kgPerUnit} kg)
            </dd>
          </div>
        )}
        {priceUnits?.INTERNATIONAL && (
          <div className="sm:col-span-2">
            <dt className="text-subtle">International price metric</dt>
            <dd className="text-muted-foreground">
              {priceUnits.INTERNATIONAL.currency} / {priceUnits.INTERNATIONAL.weightUnit} (
              {priceUnits.INTERNATIONAL.kgPerUnit} kg)
            </dd>
          </div>
        )}
      </dl>
      {params?.length ? (
        <div className="text-[11px]">
          <div className="font-medium text-muted-foreground">Trade parameter templates ({params.length})</div>
          <ul className="mt-1 list-inside list-disc text-subtle">
            {params.map((p) => (
              <li key={p.label}>
                {p.label} <span className="text-[10px] uppercase">({p.group})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ChangeRequestPayloadPreview({
  entityType,
  entityRef,
  action,
  payload,
  department,
}: {
  entityType: string;
  entityRef: string;
  action: string;
  payload: Record<string, unknown>;
  department?: string;
}) {
  if (action === "DELETE" || !payload || !Object.keys(payload).length) return null;

  // Closing short or cancelling a locked trade — both abandon the open quantity
  // and settle it in money, so both carry the note the CEO is signing off on.
  if (
    entityType === "TRADE" &&
    (action === "CANCEL" || action === "CLOSE") &&
    payload.settlementPricePerMaund != null
  ) {
    const n = (v: unknown) => (v == null ? 0 : Number(v));
    const fmtN = (v: number) => v.toLocaleString("en-PK", { maximumFractionDigits: 2 });
    const rate = n(payload.ratePerMaund);
    const settlement = n(payload.settlementPricePerMaund);
    const diff = n(payload.diffPerMaund);
    const amount = n(payload.amountPkr);
    const openQty = n(payload.openQtyMt);
    const openMaunds = n(payload.openMaunds);
    return (
      <div className="mt-3 space-y-2 rounded-lg border border-kastros-border/70 bg-black/15 p-3">
        <div className="text-xs font-semibold text-foreground">
          {action === "CANCEL" ? "Cancellation debit note" : "Short-close debit note"}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-3">
          <div>
            <div className="text-subtle">Trade rate (incl. comm.)</div>
            <div className="font-mono text-muted-foreground">{fmtN(rate)} ₨/maund</div>
          </div>
          <div>
            <div className="text-subtle">Settlement price</div>
            <div className="font-mono text-muted-foreground">{fmtN(settlement)} ₨/maund</div>
          </div>
          <div>
            <div className="text-subtle">Open quantity</div>
            <div className="font-mono text-muted-foreground">
              {fmtN(openQty)} MT ({fmtN(openMaunds)} maund)
            </div>
          </div>
        </div>
        <p className="text-[11px]">
          {amount <= 0.005 ? (
            <span className="text-subtle">
              Settlement equals the trade rate — cancelling posts{" "}
              <span className="text-foreground">no ledger entry</span>.
            </span>
          ) : diff > 0 ? (
            <span className="text-success">
              Seller owes {fmtN(amount)} PKR ({fmtN(openMaunds)} maund × {fmtN(diff)}) — approving
              posts a debit note on their receivable ledger.
            </span>
          ) : (
            <span className="text-warning">
              We owe the seller {fmtN(amount)} PKR ({fmtN(openMaunds)} maund × {fmtN(Math.abs(diff))})
              — approving posts a credit note on their payable ledger.
            </span>
          )}
        </p>
      </div>
    );
  }

  if (entityType === "TRADE") {
    return (
      <TradeEditChangePreview
        tradeRef={entityRef}
        payload={payload}
        useCeoLookup={department === "TRADING"}
      />
    );
  }

  if (entityType === "OPEN_TRADE_WAREHOUSE") {
    const split = payload.warehouseSplit as { warehouseName: string; openQtyMt: number }[] | undefined;
    if (!split?.length) return null;
    return (
      <div className="mt-3 space-y-2 rounded-lg border border-kastros-border/70 bg-black/15 p-3">
        <div className="text-xs font-semibold text-foreground">Proposed warehouse allocation</div>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-kastros-border/60 text-subtle">
              <th className="py-1.5 pr-3 font-medium">Warehouse</th>
              <th className="py-1.5 font-medium tabular-nums">Quantity (MT)</th>
            </tr>
          </thead>
          <tbody>
            {split.map((line) => (
              <tr key={line.warehouseName} className="text-muted-foreground">
                <td className="py-1.5 pr-3">{line.warehouseName}</td>
                <td className="py-1.5 tabular-nums">{line.openQtyMt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-subtle">
          Total: {split.reduce((s, l) => s + l.openQtyMt, 0).toFixed(3)} MT ·{" "}
          <Link href={`/execution/open-trades/${encodeURIComponent(entityRef)}`} className="text-accent-secondary hover:underline">
            Open trade →
          </Link>
        </p>
      </div>
    );
  }

  if (entityType === "WAREHOUSE" && (action === "CREATE" || action === "EDIT")) {
    return (
      <div className="mt-3 space-y-3">
        <WarehouseStorageMetricsPreview payload={payload} />
        <GenericPayloadPreview payload={payload} />
      </div>
    );
  }

  if (entityType === "COMMODITY" && action === "CREATE") {
    return <CommodityCreatePreview payload={payload} />;
  }

  if (entityType === "GATE_ENTRY" || entityType === "INBOUND" || entityType === "OUTBOUND") {
    return (
      <div className="mt-3 space-y-2 rounded-lg border border-kastros-border/70 bg-black/15 p-3">
        <div className="text-xs font-semibold text-foreground">Proposed gate register changes</div>
        <GenericPayloadPreview payload={payload} />
        <p className="text-[10px] text-subtle">
          <Link href="/execution/movements" className="text-accent-secondary hover:underline">
            Open truck movements →
          </Link>
        </p>
      </div>
    );
  }

  return <GenericPayloadPreview payload={payload} />;
}

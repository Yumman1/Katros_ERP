"use client";

import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";

type Props = {
  compact?: boolean;
};

export function PendingWarehousePanel({ compact }: Props) {
  const { data: pending } = trpc.execution.pendingWarehouseAllocation.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (!pending?.length) return null;

  if (compact) {
    return (
      <section className="exec-alert-warning">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 flex-shrink-0 text-warning"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h2 className="text-sm font-semibold text-warning">
            {pending.length} unreviewed trade{pending.length !== 1 ? "s" : ""} need warehouse allocation
          </h2>
        </div>
        <p className="ml-6 mt-1 text-xs text-muted-foreground">
          Allocate quantities per warehouse on Unreviewed Trades and get head approval before locking.
        </p>
        <ul className="ml-6 mt-2 space-y-1">
          {pending.slice(0, 5).map((t) => (
            <li key={t.tradeRef} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Link
                href={`/execution/open-trades/${encodeURIComponent(t.tradeRef)}`}
                className="font-mono font-semibold text-accent-secondary hover:underline"
              >
                {t.tradeRef}
              </Link>
              <span>·</span>
              <span>{t.counterpartyName}</span>
            </li>
          ))}
        </ul>
        <Link
          href="/execution/open-trades"
          className="ml-6 mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-secondary hover:underline"
        >
          Unreviewed trades →
        </Link>
      </section>
    );
  }

  return (
    <section className="exec-alert-warning p-5">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-warning">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
        Warehouse allocation required ({pending.length})
      </h2>
      <p className="mb-3 text-xs text-subtle">
        These unreviewed trades need quantities split across warehouses and head approval before they can be locked.
      </p>
      <div className="kastros-table-wrap border-0 shadow-none">
        <table className="kastros-table text-xs">
          <thead>
            <tr>
              {["Contract", "Direction", "Counterparty", "Commodity", "Qty", "Status", ""].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pending.map((t) => (
              <tr key={t.tradeRef}>
                <td className="font-mono font-semibold text-accent-secondary">{t.tradeRef}</td>
                <td className={t.direction === "BUY" ? "text-success" : "exec-profile-sale"}>{t.direction}</td>
                <td className="text-muted-foreground">{t.counterpartyName}</td>
                <td className="text-muted-foreground">{t.commodityCode}</td>
                <td className="tabular-nums text-muted-foreground">
                  {formatQtyWithUnit(t.quantity, t.quantityUnit, 2)}
                </td>
                <td>
                  {t.pendingWarehouseApproval ? (
                    <span className="text-warning">Awaiting head approval</span>
                  ) : (
                    <span className="text-destructive">Not allocated</span>
                  )}
                </td>
                <td>
                  <Link
                    href={`/execution/open-trades/${encodeURIComponent(t.tradeRef)}`}
                    className="font-medium text-accent-secondary hover:underline"
                  >
                    Allocate →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

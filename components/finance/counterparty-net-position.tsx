"use client";

import { useMemo, useState } from "react";
import { counterpartyNetPositions, type NetPositionAccount } from "@/lib/counterparty-net-position";
import { cn } from "@/lib/utils";

const money = (n: number) => new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(n);

export function CounterpartyNetPosition({ accounts, selectedId, onSelect }: {
  accounts: NetPositionAccount[]; selectedId: string | null; onSelect: (id: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const positions = useMemo(() => counterpartyNetPositions(accounts), [accounts]);
  const rows = positions.filter((r) => `${r.counterpartyName} ${r.counterpartyCode}`.toLowerCase().includes(search.toLowerCase())
    && (status === "all" || (status === "receivable" ? r.netPkr > 0 : status === "payable" ? r.netPkr < 0 : r.netPkr === 0)));
  return (
    <section className="exec-panel space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Counterparty net position</h2>
        <p className="text-xs text-subtle">Current full-history balance in PKR. + They owe us · − We owe them. Held purchase dues are included; this summary does not offset ledger accounts.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Search counterparty net positions" className="kastros-input" placeholder="Search counterparty…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Net balance status" className="kastros-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All balances</option><option value="receivable">They owe us</option><option value="payable">We owe them</option><option value="balanced">Balanced</option>
        </select>
        {selectedId && <button type="button" className="kastros-btn-secondary" onClick={() => onSelect(null)}>Show all ledger details</button>}
      </div>
      <div className="kastros-table-wrap max-h-80 overflow-auto">
        <table className="kastros-table text-xs">
          <thead><tr>{["Counterparty", "Receivable (PKR)", "Payable (PKR)", "Net (PKR)", "Position", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.counterpartyId} className={selectedId === r.counterpartyId ? "bg-brand/10" : ""}>
            <td>{r.counterpartyName} <span className="text-subtle">({r.counterpartyCode})</span></td>
            <td className="tabular-nums">{money(r.receivablePkr)}</td><td className="tabular-nums">{money(r.payablePkr)}</td>
            <td className={cn("font-semibold tabular-nums", r.netPkr > 0 ? "text-success" : r.netPkr < 0 ? "text-warning" : "text-subtle")}>{r.netPkr > 0 ? "+" : ""}{money(r.netPkr)}</td>
            <td>{r.netPkr > 0 ? "They owe us" : r.netPkr < 0 ? "We owe them" : "Balanced"}</td>
            <td><button type="button" className="text-accent-secondary hover:underline" onClick={() => onSelect(r.counterpartyId)}>View ledger</button></td>
          </tr>)}</tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-subtle">No matching counterparties.</p>}
      </div>
    </section>
  );
}

"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { useExecutionCommodityDesk } from "./commodity-desk-provider";
import { SearchableSelect } from "@/components/ui/searchable-select";

export function InternationalPurchaseVoucher() {
  const { entity } = useExecutionCommodityDesk();
  const utils = trpc.useUtils();
  const counterparties = trpc.execution.sellCounterparties.useQuery();
  const [counterpartyId, setParty] = useState("");
  const [tradeRef, setTrade] = useState("");
  const [blId, setBl] = useState("");
  const [amount, setAmount] = useState("");
  const [voucherDate, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const trades = trpc.sesameExport.purchaseTrades.useQuery({ counterpartyId }, { enabled: !!counterpartyId });
  const bls = trpc.sesameExport.purchaseBls.useQuery({ tradeRef }, { enabled: !!tradeRef });
  const save = trpc.sesameExport.createPurchase.useMutation({
    onSuccess: (r) => {
      setMessage(`${r.voucherNo} sent to Finance.`);
      setAmount("");
      setNote("");
      void utils.invalidate();
    },
  });
  const trade = trades.data?.find((t) => t.tradeRef === tradeRef);
  const bl = bls.data?.find((b) => b.id === blId);
  const currency = trade?.currency === "USD" || entity === "FZCO" ? "USD" : "PKR";
  const fx = trade?.fxRate ?? 1;
  const scale = currency === "USD" ? (fx || 1) : 1;
  const outstanding = (bl ? bl.outstandingPkr : trade?.amountPkr ?? 0) / scale;
  return (
    <section className="space-y-4 mt-4">
      <h3 className="font-semibold">International purchase</h3>
      <p className="text-sm text-subtle">
        Pay a supplier (or Kastros Pakistan on an internal sale) after the BL. Finance prints the voucher, then enters method, bank and reference on approval.
        {entity === "FZCO" ? " FZCO pays Pakistan only after the buyer has paid the linked BL in full." : ""}
      </p>
      <form
        className="grid gap-3 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!window.confirm(`Generate purchase voucher for ${tradeRef}${bl ? `, BL ${bl.blNo}` : ""}?`)) return;
          save.mutate({
            counterpartyId,
            tradeRef,
            exportShipmentId: blId || undefined,
            amount: Number(amount),
            voucherDate: new Date(voucherDate),
            note: note.trim() || undefined,
          });
        }}
      >
        <label>Counterparty
          <SearchableSelect required className="kastros-select w-full" value={counterpartyId} onChange={(e) => { setParty(e.target.value); setTrade(""); setBl(""); }}>
            <option value="">Select counterparty</option>
            {(counterparties.data ?? []).map((cp) => <option key={cp.id} value={cp.id}>{cp.code} — {cp.name}</option>)}
          </SearchableSelect>
        </label>
        <label>Trade
          <select required className="kastros-select w-full" value={tradeRef} onChange={(e) => { setTrade(e.target.value); setBl(""); }}>
            <option value="">Select purchase</option>
            {(trades.data ?? []).map((t) => <option key={t.tradeRef} value={t.tradeRef}>{t.tradeRef} · {t.openMt.toFixed(3)} MT open</option>)}
          </select>
        </label>
        <label>BL number (optional)
          <select className="kastros-select w-full" value={blId} onChange={(e) => setBl(e.target.value)}>
            <option value="">No BL — pay against the trade</option>
            {(bls.data ?? []).map((b) => <option key={b.id} value={b.id}>BL {b.blNo}{b.triparty && !b.buyerPaid ? " · awaiting buyer payment" : ""} · {b.outstandingPkr.toLocaleString()} PKR open</option>)}
          </select>
        </label>
        <label>Voucher date
          <input required type="date" className="kastros-input w-full" value={voucherDate} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>Amount ({currency})
          <input required type="number" min="0.01" step="0.01" max={outstanding || undefined} className="kastros-input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>Note (optional)
          <input maxLength={1000} className="kastros-input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {trade && <p className="text-sm md:col-span-3">Agreed value: {(trade.amountPkr / scale).toLocaleString()} {currency}{currency === "USD" ? ` · FX ${fx} PKR/USD` : ""}{bl ? ` · BL outstanding ${(bl.outstandingPkr / scale).toLocaleString()}` : ""}</p>}
        <button className="kastros-btn-primary" disabled={save.isPending || !tradeRef || Number(amount) <= 0 || (currency === "USD" && fx <= 0)}>Generate purchase voucher</button>
      </form>
      {message && <p role="status">{message}</p>}
      {(counterparties.error || trades.error || bls.error || save.error) && <p role="alert" className="text-destructive">{counterparties.error?.message || trades.error?.message || bls.error?.message || save.error?.message}</p>}
    </section>
  );
}

import type { CommercialReport } from "./commercial";

export async function exportCommercialReport(data: CommercialReport, kind: "excel" | "pdf") {
  const filename = `commodity-sales-${data.filters.from}-${data.filters.to}`;
  const metadata = [
    ["Report", "Commodity sales and commercial margins"], ["Scope", data.scope],
    ["From", data.filters.from], ["To", data.filters.to], ["Timezone", "Asia/Karachi"],
    ["Basis", data.filters.basis], ["Period grouping", data.filters.groupBy],
    ["Commodity", data.options.commodities.find((o) => o.id === data.filters.commodityId)?.name ?? "All"],
    ["Counterparty", data.options.counterparties.find((o) => o.id === data.filters.counterpartyId)?.name ?? "All"],
    ["Warehouse", data.filters.warehouse ?? "All"], ["Generated at", data.generatedAt],
    ["Profit formula", "Sales minus purchase cost of sold quantity; moving weighted-average linked batch receipt cost"],
    ["Exclusions", "Gross profit before tax, freight, commission and overhead. Untraceable costs excluded; currencies separate."],
    ["Period difference", "Purchase minus sales includes unsold stock; it is not gross profit."],
  ];
  if (kind === "excel") {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    const sheet = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
    sheet("Report details", metadata);
    const headers = ["Period", "Commodity", "Currency", "Bought MT", "Purchase value", "Sold MT", "Sales value", "Purchase minus sales", "Matched cost", "Matched profit", "Matched margin %", "Costed sales", "Uncosted sales", "Missing values", "Missing quantities"];
    for (const [name, rows] of [["Commodity summary", data.commodities], ["Period summary", data.periods]] as const) {
      sheet(name, [headers, ...rows.map((r) => [r.period, r.commodity, r.currency, r.purchaseQtyMt, r.purchaseValue, r.salesQtyMt, r.salesValue, r.purchaseMinusSales, r.costedCount ? r.purchaseCost : null, r.costedCount ? r.matchedProfit : null, r.marginPct, r.costedCount, r.uncostedCount, r.missingValues, r.missingQuantities])]);
    }
    sheet("Previous period", [["Previous from", data.previousRange.from], ["Previous to", data.previousRange.to], ["Commodity", "Currency", "Current sales", "Previous sales", "Change", "Change %"], ...data.comparisons.map((r) => [r.commodity, r.currency, r.sales, r.previousSales, r.change, r.changePct])]);
    sheet("Leading buyers", [["Buyer", "Currency", "Sales value", "Sold MT", "Sales count", "Missing values"], ...data.buyers.map((r) => [r.counterparty, r.currency, r.sales, r.quantityMt, r.count, r.missingValues])]);
    sheet("Batch sales", [["Sale", "Trade", "Batch", "Date", "Commodity", "Buyer", "Warehouse", "Currency", "Sold MT", "Purchase cost", "Sales value", "Profit", "Cost basis", "Purchase references"],
      ...data.sales.map((s) => [s.reference, s.tradeRef, s.batchRefs.join(", "), s.date, s.commodity, s.counterparty, s.warehouse, s.currency, s.quantityKg == null ? null : s.quantityKg / 1000, s.purchaseCost, s.amount, s.profit, s.costReason, s.purchaseRefs.join(", ")])]);
    sheet("Purchases", [["Reference", "Trade", "Batch", "Date", "Commodity", "Seller", "Warehouse", "Currency", "Bought MT", "Purchase value"],
      ...data.purchases.map((p) => [p.reference, p.tradeRef, p.batchRefs.join(", "), p.date, p.commodity, p.counterparty, p.warehouse, p.currency, p.quantityKg == null ? null : p.quantityKg / 1000, p.amount])]);
    XLSX.writeFile(book, `${filename}.xlsx`);
  } else {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape" });
    let y = 15;
    const line = (value: string, size = 9) => {
      doc.setFontSize(size);
      const lines: string[] = doc.splitTextToSize(value, 267);
      for (const text of lines) {
        if (y > 190) { doc.addPage(); y = 15; }
        doc.text(text, 15, y); y += size > 10 ? 7 : 5;
      }
    };
    line("Commodity sales and commercial margins", 16);
    for (const [key, value] of metadata.slice(1)) line(`${key}: ${value}`);
    line("Commodity summary", 13);
    const n = (value: number | null) => value == null ? "Not calculated" : value.toLocaleString("en-PK", { maximumFractionDigits: 2 });
    for (const r of data.commodities) {
      line(`${r.commodity} (${r.currency}) | Bought ${n(r.purchaseQtyMt)} MT for ${n(r.purchaseValue)} | Sold ${n(r.salesQtyMt)} MT for ${n(r.salesValue)}`);
      line(`Purchase - sales: ${n(r.purchaseMinusSales)} | Matched cost: ${n(r.costedCount ? r.purchaseCost : null)} | Matched profit: ${n(r.costedCount ? r.matchedProfit : null)} | Cost coverage: ${r.costedCount}/${r.salesCount} sales | Missing values: ${r.missingValues}, quantities: ${r.missingQuantities}`);
    }
    line("Period summary", 13);
    for (const r of data.periods) line(`${r.period} | ${r.commodity} | ${r.currency} | Sales ${n(r.salesValue)} | Matched profit ${n(r.costedCount ? r.matchedProfit : null)} | Cost coverage ${r.costedCount}/${r.salesCount}`);
    line(`Previous period: ${data.previousRange.from} to ${data.previousRange.to}`, 13);
    for (const r of data.comparisons) line(`${r.commodity} | ${r.currency} | Current ${n(r.sales)} | Previous ${n(r.previousSales)} | Change ${n(r.change)} (${n(r.changePct)}%)`);
    line("Leading buyers", 13);
    for (const r of data.buyers) line(`${r.counterparty} | ${r.currency} ${n(r.sales)} | ${n(r.quantityMt)} MT | ${r.count} sales | Missing values ${r.missingValues}`);
    line("Batch sale detail", 13);
    for (const s of data.sales) {
      line(`${s.batchRefs.join(", ") || "Unlinked"} | ${s.reference} | ${s.counterparty} | ${s.date.slice(0, 10)} | ${s.currency}`);
      line(`Sold quantity (MT): ${n(s.quantityKg == null ? null : s.quantityKg / 1000)} | Bought for: ${n(s.purchaseCost)} | Sold for: ${n(s.amount)} | Profit/loss: ${n(s.profit)}`);
      line(`Cost basis: ${s.costReason} | Purchase references: ${s.purchaseRefs.join(", ") || "Unavailable"}`);
    }
    line("Purchase detail", 13);
    for (const p of data.purchases) line(`${p.reference} | Batch ${p.batchRefs.join(", ") || "Unlinked"} | ${p.counterparty} | ${p.currency} ${n(p.amount)} | ${n(p.quantityKg == null ? null : p.quantityKg / 1000)} MT`);
    doc.save(`${filename}.pdf`);
  }
}

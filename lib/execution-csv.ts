import type { ExecutionContract } from "@/server/execution-store";

function esc(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cells: (string | number | null | undefined)[]) {
  return cells.map(esc).join(",");
}

export function lockedContractsToCsv(contracts: ExecutionContract[]) {
  const purchase = contracts.filter((c) => c.executionProfile !== "SALE_EX_WAREHOUSE");
  const sale = contracts.filter((c) => c.executionProfile === "SALE_EX_WAREHOUSE");

  const lines: string[] = [];

  if (purchase.length) {
    lines.push(
      row([
        "Contract#",
        "Contract Date",
        "Quantity Unit",
        "Contractual Qty",
        "Buying Category",
        "Seller",
        "NTN No.",
        "Damage",
        "Broken",
        "Fungus",
        "Foreign Matters",
        "Moisture",
        "Rate per maund",
        "Rate / kg",
        "Commission",
        "Qty Received",
        "Open Qty",
        "Status",
      ]),
    );
    for (const c of purchase) {
      lines.push(
        row([
          c.tradeRef,
          c.contractDate.toISOString().slice(0, 10),
          c.quantityUnit,
          c.contractualQtyMt,
          c.buyingCategory ?? "Delivered",
          c.counterpartyName,
          c.counterpartyNtn ?? "",
          c.qualityTolerances.damagePct,
          c.qualityTolerances.brokenPct,
          c.qualityTolerances.fungusPct,
          c.qualityTolerances.foreignMatterPct,
          c.qualityTolerances.moisturePct,
          c.ratePerMaund ?? "",
          c.ratePerKg ?? "",
          c.commissionPerMaund ?? "",
          c.receivedQtyMt,
          c.openQtyMt,
          c.contractStatus,
        ]),
      );
    }
  }

  if (sale.length) {
    if (lines.length) lines.push("");
    lines.push(
      row([
        "Contract No.",
        "Sale Trade Date",
        "Buyer Name",
        "CP ID",
        "NTN",
        "Commodity",
        "Quantity Unit",
        "Qty",
        "Rate / Maund",
        "Executed Qty",
        "Open Qty",
        "Status",
      ]),
    );
    for (const c of sale) {
      lines.push(
        row([
          c.tradeRef,
          c.contractDate.toISOString().slice(0, 10),
          c.counterpartyName,
          c.counterpartyCode,
          c.counterpartyNtn ?? "",
          c.commodityName,
          c.quantityUnit,
          c.contractualQtyMt,
          c.ratePerMaund ?? "",
          c.receivedQtyMt,
          c.openQtyMt,
          c.contractStatus,
        ]),
      );
    }
  }

  return lines.join("\n");
}

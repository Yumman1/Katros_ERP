import type { VoucherView } from "@/server/finance/vouchers";

export async function downloadPurchaseVoucher(v: VoucherView) {
  const {jsPDF} = await import("jspdf");
  const pdf = new jsPDF();
  const fontData = await Promise.all(["DejaVuSans.ttf","DejaVuSans-Bold.ttf"].map(async name => {
    const response = await fetch(`/fonts/${name}`);
    if (!response.ok) throw new Error("Could not load voucher font. Please retry the download.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }));
  pdf.addFileToVFS("DejaVuSans.ttf", fontData[0]);
  pdf.addFileToVFS("DejaVuSans-Bold.ttf", fontData[1]);
  pdf.addFont("DejaVuSans.ttf", "Voucher", "normal");
  pdf.addFont("DejaVuSans-Bold.ttf", "Voucher", "bold");
  pdf.setFillColor(61, 53, 94); pdf.rect(145, 14, 48, 13, "F");
  pdf.setFont("Voucher", "bold"); pdf.setFontSize(26); pdf.text("KASTROS", 18, 26);
  pdf.setFontSize(15); pdf.text("PURCHASE PAYMENT VOUCHER", 105, 48, {align:"center"});
  pdf.setFont("Voucher", "normal"); pdf.setFontSize(10);
  pdf.text(v.voucherNo, 18, 62); pdf.text(new Date(v.voucherDate).toLocaleDateString("en-GB"), 192, 62, {align:"right"});
  const rows = [
    ["Supplier", v.counterpartyName], ["Trade reference", v.tradeRef ?? "-"],
    ["Purchase basis", v.purchaseProfile === "PURCHASE_SPOT" ? "Spot (seller loading weight; no deductions)" : "Delivered (warehouse weight less lab deduction)"],
    ["Truck number", v.truckNo ?? "-"], ["Builty number", v.builtyNumber ?? "-"],
    ["Transporter", v.transporterName ?? "-"], ["Advance weight", `${v.advanceWeightKg?.toLocaleString() ?? "-"} kg`],
    ["Advance percentage", `${v.advancePercentage ?? 0}%`],
    ["Calculated amount", `${(v.calculatedAdvancePkr ?? 0).toLocaleString("en-PK")} PKR`],
    ["Requested payment", `${v.amountPkr.toLocaleString("en-PK")} PKR`],
    ["Payment reference", v.reference ?? "Pending finance payment"],
    ["Status", v.status === "APPROVED" ? "Complete - payment approved" : v.status === "REJECTED" ? "Rejected" : "Pending finance reconciliation"],
  ];
  let y = 77;
  for (const [label,value] of rows) {
    const lines = pdf.splitTextToSize(value, 111); const height = Math.max(10, lines.length * 5 + 5);
    pdf.setDrawColor(180); pdf.rect(18,y,174,height); pdf.line(76,y,76,y+height);
    pdf.setFont("Voucher","bold"); pdf.text(label,21,y+6);
    pdf.setFont("Voucher","normal"); pdf.text(lines,79,y+6); y+=height;
  }
  pdf.text(`Prepared by: ${v.enteredByName}`,18,y+12);
  pdf.text(`Approved by: ${v.resolvedByName ?? "________________"}`,18,y+22);
  pdf.setFontSize(9); pdf.text("Payment request only. Completion requires Finance approval and a payment reference.",18,280);
  pdf.save(`${v.voucherNo}-purchase-voucher.pdf`);
}

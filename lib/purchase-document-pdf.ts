export async function downloadPurchaseDocument(title:string,ref:string,date:Date|string,rows:string[][],filename:string) {
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

  const heading=()=>{pdf.setFont("Voucher","bold");pdf.setFontSize(23);pdf.text("KASTROS",18,24);pdf.setFontSize(13);pdf.text(title,18,35);pdf.setFont("Voucher","normal");pdf.setFontSize(9);pdf.text(ref,18,45);pdf.text(new Date(date).toLocaleDateString("en-GB"),192,45,{align:"right"});};
  heading(); let y=53;
  for(const [label,value] of rows){
    const lines=pdf.splitTextToSize(value,108);const labels=pdf.splitTextToSize(label,52);
    const h=Math.max(8,Math.max(lines.length,labels.length)*4.5+3.5);
    if(y+h>270){pdf.addPage();heading();y=53;}
    pdf.setDrawColor(190);pdf.rect(18,y,174,h);pdf.line(77,y,77,y+h);
    pdf.setFont("Voucher","bold");pdf.text(labels,21,y+5.5);pdf.setFont("Voucher","normal");pdf.text(lines,80,y+5.5);y+=h;
  }
  const count=pdf.getNumberOfPages();for(let i=1;i<=count;i++){pdf.setPage(i);pdf.setFontSize(8);pdf.text(`Page ${i} of ${count} | KASTROS`,18,285);}
  pdf.save(filename);
}

import { redirect } from "next/navigation";

/** Invoice approvals opens on the buy tab. */
export default function InvoiceApprovalsIndexPage() {
  redirect("/trader/invoice-approvals/buy");
}

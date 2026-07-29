import { redirect } from "next/navigation";

/** Moved under Invoice approvals — kept so existing links and bookmarks work. */
export default function SellInvoiceApprovalsRedirectPage() {
  redirect("/trader/invoice-approvals/sell");
}

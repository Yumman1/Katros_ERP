import { redirect } from "next/navigation";

/** Moved under Approvals — kept so existing links and bookmarks work. */
export default function OverDeliveryApprovalsRedirectPage() {
  redirect("/trader/approvals/over-delivery");
}

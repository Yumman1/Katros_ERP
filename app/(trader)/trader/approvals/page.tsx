import { redirect } from "next/navigation";

/** Approvals opens on the trade-changes tab. */
export default function TraderApprovalsIndexPage() {
  redirect("/trader/approvals/trade-changes");
}

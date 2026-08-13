import { redirect } from "next/navigation";

/** Legacy route — all execution change requests live on Approvals / My requests. */
export default function ExecutionChangeRequestsPage() {
  redirect("/execution/my-approvals");
}

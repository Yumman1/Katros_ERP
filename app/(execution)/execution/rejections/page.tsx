import { redirect } from "next/navigation";

export default function LegacyExecutionRejectionsPage() {
  redirect("/execution/approvals/rejections");
}

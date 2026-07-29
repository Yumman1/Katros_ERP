import { redirect } from "next/navigation";

/** Rejections opens on the full list. */
export default function RejectionsIndexPage() {
  redirect("/trader/rejections/all");
}

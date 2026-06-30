import { redirect } from "next/navigation";

export default function PurchaseDeliveredRedirect() {
  redirect("/execution/local/purchase-delivered");
}

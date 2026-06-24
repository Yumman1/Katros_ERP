import type { Session } from "next-auth";
import { canonicalTraderName } from "@/lib/trader-identity";

/** Display name for the logged-in trader (name from profile, else email). */
export function traderDisplayName(session: Session | null | undefined): string {
  const user = session?.user;
  if (!user) return "";
  return canonicalTraderName(user.name?.trim() || user.email?.trim() || "");
}

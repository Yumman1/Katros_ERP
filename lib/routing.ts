import type { Role } from "@prisma/client";

export function getHomeForRole(role: Role): string {
  switch (role) {
    case "TRADER":
      return "/trader";
    case "EXECUTION":
      return "/execution";
    case "FINANCE":
      return "/finance/payments";
      return "/cashflow";
    case "RISK_MANAGER":
      return "/positions";
    default:
      return "/";
  }
}

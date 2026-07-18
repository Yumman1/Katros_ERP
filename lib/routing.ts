import type { Role } from "@prisma/client";

export function getHomeForRole(role: Role): string {
  switch (role) {
    case "CEO":
      return "/ceo";
    case "ADMIN":
      return "/overview";
    case "TRADER":
      return "/trader";
    case "EXECUTION":
      return "/execution";
    case "FINANCE":
      return "/finance/payments";
    case "RISK_MANAGER":
      return "/positions";
    case "READ_ONLY":
      return "/overview";
    default:
      return "/login";
  }
}

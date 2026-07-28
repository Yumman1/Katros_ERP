import type { Role } from "@prisma/client";

export const DEPARTMENTS = ["EXECUTION", "FINANCE", "TRADING"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  EXECUTION: "Execution",
  FINANCE: "Finance",
  TRADING: "Trading",
};

/** Base path of each department's workspace (used for change-request inbox links). */
export const DEPARTMENT_HOME: Record<Department, string> = {
  EXECUTION: "/execution",
  FINANCE: "/finance",
  TRADING: "/trader",
};

/** The department a role belongs to (null for cross-cutting roles like ADMIN / RISK / READ_ONLY). */
export function departmentForRole(role: Role): Department | null {
  switch (role) {
    case "EXECUTION":
      return "EXECUTION";
    case "FINANCE":
      return "FINANCE";
    case "TRADER":
      return "TRADING";
    default:
      return null;
  }
}

/** Roles that belong to a department (used to gate a head to their own team). */
export function rolesForDepartment(dept: Department): Role[] {
  switch (dept) {
    case "EXECUTION":
      return ["EXECUTION"];
    case "FINANCE":
      return ["FINANCE"];
    case "TRADING":
      return ["TRADER"];
  }
}

/** Whether a (possibly head) user can act on a given department. CEO spans all departments. */
export function canActOnDepartment(role: Role, isHead: boolean, dept: Department): boolean {
  if (role === "CEO" || role === "ADMIN") return true;
  return isHead && departmentForRole(role) === dept;
}

export const CHANGE_REQUEST_ACTIONS = ["CREATE", "EDIT", "DELETE", "CLOSE", "CANCEL"] as const;
export type ChangeRequestAction = (typeof CHANGE_REQUEST_ACTIONS)[number];

export const CHANGE_REQUEST_STATUSES = ["PENDING", "PENDING_CEO", "APPROVED", "REJECTED"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

/** Executive approval — CEO or ADMIN. */
export function canActAsCeo(role: Role): boolean {
  return role === "CEO" || role === "ADMIN";
}

export function requiresCeoApproval(
  entityType: string,
  action: ChangeRequestAction,
  department?: Department,
): boolean {
  if (entityType === "WAREHOUSE" && action === "CREATE") return true;
  if (entityType === "TRADE" && action === "CLOSE") return true;
  // Cancelling a locked trade posts a debit/credit note — always the CEO's call.
  if (entityType === "TRADE" && action === "CANCEL") return true;
  if (entityType === "COMMODITY" && action === "CREATE") return true;
  if (
    department === "TRADING" &&
    entityType === "TRADE" &&
    (action === "EDIT" || action === "DELETE")
  ) {
    return true;
  }
  return false;
}

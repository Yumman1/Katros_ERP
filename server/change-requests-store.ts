import type { ChangeRequest as ChangeRequestRow } from "@prisma/client";
import { prisma } from "@/server/db";
import { json } from "@/server/db/convert";
import { allocateSerial, SERIALS } from "@/server/db/serials";
import type {
  ChangeRequestAction,
  ChangeRequestStatus,
  Department,
} from "@/lib/departments";

export type ChangeRequest = {
  id: string;
  department: Department;
  /** e.g. "TRADE", "GATE_ENTRY", "PAYMENT", "INBOUND", "OUTBOUND" */
  entityType: string;
  /** Business reference of the affected entity (trade ref, gatepass no., payment id…). */
  entityRef: string;
  /** Human-friendly one-liner describing the entity. */
  entityLabel: string;
  action: ChangeRequestAction;
  comment: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: Date;
  status: ChangeRequestStatus;
  resolvedByName?: string | null;
  resolvedAt?: Date | null;
  resolutionNote?: string | null;
  /** Whether the approved action was auto-applied (e.g. delete performed). */
  applied?: boolean;
  /** Structured payload for approved EDIT actions (e.g. warehouse patch). */
  payload?: Record<string, unknown> | null;
  /** When execution head approved before CEO (warehouse create). */
  departmentApprovedByName?: string | null;
  departmentApprovedAt?: Date | null;
  departmentApprovalNote?: string | null;
};

function rowToChangeRequest(row: ChangeRequestRow): ChangeRequest {
  return {
    id: row.id,
    department: row.department,
    entityType: row.entityType,
    entityRef: row.entityRef,
    entityLabel: row.entityLabel,
    action: row.action,
    comment: row.comment,
    requestedById: row.requestedById,
    requestedByName: row.requestedByName,
    requestedAt: row.requestedAt,
    status: row.status,
    resolvedByName: row.resolvedByName,
    resolvedAt: row.resolvedAt,
    resolutionNote: row.resolutionNote,
    applied: row.applied,
    payload: json<Record<string, unknown>>(row.payload),
    departmentApprovedByName: row.departmentApprovedByName,
    departmentApprovedAt: row.departmentApprovedAt,
    departmentApprovalNote: row.departmentApprovalNote,
  };
}

export async function createChangeRequest(input: {
  department: Department;
  entityType: string;
  entityRef: string;
  entityLabel: string;
  action: ChangeRequestAction;
  comment: string;
  requestedById: string;
  requestedByName: string;
  payload?: Record<string, unknown> | null;
  status?: ChangeRequestStatus;
}): Promise<ChangeRequest> {
  const row = await allocateSerial(SERIALS.CHANGE_REQUEST, (id) =>
    prisma.changeRequest.create({
      data: {
        id,
        department: input.department,
        entityType: input.entityType,
        entityRef: input.entityRef,
        entityLabel: input.entityLabel,
        action: input.action,
        comment: input.comment.trim(),
        requestedById: input.requestedById,
        requestedByName: input.requestedByName,
        status: input.status ?? "PENDING",
        payload: (input.payload ?? undefined) as object | undefined,
      },
    }),
  );
  return rowToChangeRequest(row);
}

export async function listChangeRequests(filter?: {
  department?: Department;
  status?: ChangeRequestStatus;
  requestedById?: string;
}): Promise<ChangeRequest[]> {
  const rows = await prisma.changeRequest.findMany({
    where: {
      department: filter?.department,
      status: filter?.status,
      requestedById: filter?.requestedById,
    },
    orderBy: { requestedAt: "desc" },
  });
  return rows.map(rowToChangeRequest);
}

export async function countPendingChangeRequests(department: Department): Promise<number> {
  return prisma.changeRequest.count({ where: { department, status: "PENDING" } });
}

export async function countPendingCeoApprovals(): Promise<number> {
  return prisma.changeRequest.count({ where: { status: "PENDING_CEO" } });
}

export async function hasOpenChangeRequest(filter: {
  entityRef: string;
  entityType: string;
  action?: ChangeRequestAction;
}): Promise<boolean> {
  const count = await prisma.changeRequest.count({
    where: {
      entityRef: filter.entityRef,
      entityType: filter.entityType,
      action: filter.action,
      status: { in: ["PENDING", "PENDING_CEO"] },
    },
  });
  return count > 0;
}

/** Execution head approved — forward warehouse creation to CEO. */
export async function advanceChangeRequestToCeo(
  id: string,
  approvedByName: string,
  note?: string,
): Promise<ChangeRequest> {
  // Guarded update: only transitions PENDING → PENDING_CEO; a concurrent
  // resolve loses the race cleanly instead of double-applying.
  const updated = await prisma.changeRequest.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: "PENDING_CEO",
      departmentApprovedByName: approvedByName,
      departmentApprovedAt: new Date(),
      departmentApprovalNote: note?.trim() || null,
    },
  });
  if (updated.count === 0) {
    const exists = await prisma.changeRequest.findUnique({ where: { id } });
    if (!exists) throw new Error("Change request not found");
    throw new Error("Change request is not pending department approval");
  }
  const row = await prisma.changeRequest.findUniqueOrThrow({ where: { id } });
  return rowToChangeRequest(row);
}

export async function getChangeRequest(id: string): Promise<ChangeRequest | null> {
  const row = await prisma.changeRequest.findUnique({ where: { id } });
  return row ? rowToChangeRequest(row) : null;
}

export async function resolveChangeRequest(
  id: string,
  decision: "APPROVED" | "REJECTED",
  resolvedByName: string,
  resolutionNote?: string,
  applied?: boolean,
): Promise<ChangeRequest> {
  const updated = await prisma.changeRequest.updateMany({
    where: { id, status: { in: ["PENDING", "PENDING_CEO"] } },
    data: {
      status: decision,
      resolvedByName,
      resolvedAt: new Date(),
      resolutionNote: resolutionNote?.trim() || null,
      applied: Boolean(applied),
    },
  });
  if (updated.count === 0) {
    const exists = await prisma.changeRequest.findUnique({ where: { id } });
    if (!exists) throw new Error("Change request not found");
    throw new Error("Change request already resolved");
  }
  const row = await prisma.changeRequest.findUniqueOrThrow({ where: { id } });
  return rowToChangeRequest(row);
}

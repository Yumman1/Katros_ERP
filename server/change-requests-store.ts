import fs from "fs";
import {
  isLocalPersistEnabled,
  localDataPath,
  readPersisted,
  writePersisted,
} from "@/server/local-persist";
import type {
  ChangeRequestAction,
  ChangeRequestStatus,
  Department,
} from "@/lib/departments";

const CHANGE_REQUESTS_FILE = "change-requests.json";

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

type RuntimeState = {
  requests: ChangeRequest[];
  seq: number;
};

const globalStore = globalThis as unknown as {
  __kastrosChangeRequests?: RuntimeState;
};

function getRuntime(): RuntimeState {
  if (!globalStore.__kastrosChangeRequests) {
    const persisted = readPersisted<RuntimeState>(CHANGE_REQUESTS_FILE);
    globalStore.__kastrosChangeRequests = persisted ?? { requests: [], seq: 0 };
  }
  return globalStore.__kastrosChangeRequests;
}

function persist() {
  if (!isLocalPersistEnabled()) return;
  writePersisted(CHANGE_REQUESTS_FILE, getRuntime());
}

/** Re-read persisted state (dev has multiple worker processes sharing the file). */
function syncFromDisk() {
  if (!isLocalPersistEnabled()) return;
  try {
    // Only reload when the file exists; otherwise keep in-memory state.
    if (!fs.existsSync(localDataPath(CHANGE_REQUESTS_FILE))) return;
    const persisted = readPersisted<RuntimeState>(CHANGE_REQUESTS_FILE);
    if (persisted) globalStore.__kastrosChangeRequests = persisted;
  } catch {
    // ignore
  }
}

export function createChangeRequest(input: {
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
}): ChangeRequest {
  syncFromDisk();
  const rt = getRuntime();
  rt.seq += 1;
  const req: ChangeRequest = {
    id: `CR-${rt.seq.toString().padStart(4, "0")}`,
    department: input.department,
    entityType: input.entityType,
    entityRef: input.entityRef,
    entityLabel: input.entityLabel,
    action: input.action,
    comment: input.comment.trim(),
    requestedById: input.requestedById,
    requestedByName: input.requestedByName,
    requestedAt: new Date(),
    status: input.status ?? "PENDING",
    resolvedByName: null,
    resolvedAt: null,
    resolutionNote: null,
    applied: false,
    payload: input.payload ?? null,
    departmentApprovedByName: null,
    departmentApprovedAt: null,
    departmentApprovalNote: null,
  };
  rt.requests.unshift(req);
  persist();
  return req;
}

export function listChangeRequests(filter?: {
  department?: Department;
  status?: ChangeRequestStatus;
  requestedById?: string;
}): ChangeRequest[] {
  syncFromDisk();
  let list = [...getRuntime().requests];
  if (filter?.department) list = list.filter((r) => r.department === filter.department);
  if (filter?.status) list = list.filter((r) => r.status === filter.status);
  if (filter?.requestedById) list = list.filter((r) => r.requestedById === filter.requestedById);
  return list.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
}

export function countPendingChangeRequests(department: Department): number {
  return listChangeRequests({ department, status: "PENDING" }).length;
}

export function countPendingCeoApprovals(): number {
  return listChangeRequests({ status: "PENDING_CEO" }).length;
}

export function hasOpenChangeRequest(filter: {
  entityRef: string;
  entityType: string;
  action?: ChangeRequestAction;
}): boolean {
  return listChangeRequests().some(
    (r) =>
      r.entityRef === filter.entityRef &&
      r.entityType === filter.entityType &&
      (!filter.action || r.action === filter.action) &&
      (r.status === "PENDING" || r.status === "PENDING_CEO"),
  );
}

/** Execution head approved — forward warehouse creation to CEO. */
export function advanceChangeRequestToCeo(
  id: string,
  approvedByName: string,
  note?: string,
): ChangeRequest {
  syncFromDisk();
  const rt = getRuntime();
  const req = rt.requests.find((r) => r.id === id);
  if (!req) throw new Error("Change request not found");
  if (req.status !== "PENDING") throw new Error("Change request is not pending department approval");
  req.status = "PENDING_CEO";
  req.departmentApprovedByName = approvedByName;
  req.departmentApprovedAt = new Date();
  req.departmentApprovalNote = note?.trim() || null;
  persist();
  return req;
}

export function getChangeRequest(id: string): ChangeRequest | null {
  syncFromDisk();
  return getRuntime().requests.find((r) => r.id === id) ?? null;
}

export function resolveChangeRequest(
  id: string,
  decision: "APPROVED" | "REJECTED",
  resolvedByName: string,
  resolutionNote?: string,
  applied?: boolean,
): ChangeRequest {
  syncFromDisk();
  const rt = getRuntime();
  const req = rt.requests.find((r) => r.id === id);
  if (!req) throw new Error("Change request not found");
  if (req.status !== "PENDING" && req.status !== "PENDING_CEO") {
    throw new Error("Change request already resolved");
  }
  req.status = decision;
  req.resolvedByName = resolvedByName;
  req.resolvedAt = new Date();
  req.resolutionNote = resolutionNote?.trim() || null;
  req.applied = Boolean(applied);
  persist();
  return req;
}

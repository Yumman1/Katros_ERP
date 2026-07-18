import type { Department } from "@/lib/departments";
import {
  deleteInboundReceipt,
  deleteOutboundDispatch,
  deletePaymentRequest,
  deletePendingTruck,
  updatePendingTruck,
  updateInboundReceipt,
  updateOutboundDispatch,
  allocateContractWarehousesSplit,
  closeLockedContract,
} from "@/server/execution-store";
import { deleteBookedTrade } from "@/server/dummy-data";
import {
  applyExecutionTradeEditFromPayload,
  applyOpenTradeWarehouseSplit,
  applyTraderTradeEditFromPayload,
} from "@/server/open-trades";
import {
  addCustomCommodity,
  addCustomLocation,
  deleteWarehouseLocation,
  updateWarehouseLocation,
} from "@/server/trader-master-data";
import { commodityCreateInputSchema } from "@/lib/commodity-registration";

export function applyChangeRequestDeletion(
  department: Department,
  entityType: string,
  entityRef: string,
): boolean {
  try {
    if (department === "EXECUTION") {
      if (entityType === "GATE_ENTRY") return deletePendingTruck(entityRef).ok;
      if (entityType === "INBOUND") return deleteInboundReceipt(entityRef).ok;
      if (entityType === "OUTBOUND") return deleteOutboundDispatch(entityRef).ok;
      if (entityType === "WAREHOUSE") {
        deleteWarehouseLocation(entityRef);
        return true;
      }
    }
    if (department === "FINANCE" && entityType === "PAYMENT") {
      return deletePaymentRequest(entityRef).ok;
    }
    if (department === "TRADING" && entityType === "TRADE") {
      return deleteBookedTrade(entityRef).ok;
    }
  } catch {
    return false;
  }
  return false;
}

export function applyChangeRequestCreation(req: {
  department: Department;
  entityType: string;
  payload?: Record<string, unknown> | null;
}): boolean {
  try {
    if (req.department === "EXECUTION" && req.entityType === "WAREHOUSE" && req.payload) {
      addCustomLocation(req.payload as Parameters<typeof addCustomLocation>[0]);
      return true;
    }
    if (req.department === "TRADING" && req.entityType === "COMMODITY" && req.payload) {
      const parsed = commodityCreateInputSchema.safeParse(req.payload);
      if (!parsed.success) return false;
      addCustomCommodity(parsed.data);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function applyChangeRequestEdit(
  req: {
    department: Department;
    entityType: string;
    entityRef: string;
    payload?: Record<string, unknown> | null;
    action: string;
  },
  editedBy: string,
): boolean {
  try {
    if (req.department === "EXECUTION" && req.entityType === "WAREHOUSE" && req.payload) {
      updateWarehouseLocation(req.entityRef, req.payload as Parameters<typeof updateWarehouseLocation>[1]);
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "GATE_ENTRY" && req.payload) {
      updatePendingTruck(req.entityRef, req.payload as Parameters<typeof updatePendingTruck>[1]);
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "INBOUND" && req.payload) {
      updateInboundReceipt(req.entityRef, req.payload as Parameters<typeof updateInboundReceipt>[1]);
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "OUTBOUND" && req.payload) {
      updateOutboundDispatch(req.entityRef, req.payload as Parameters<typeof updateOutboundDispatch>[1]);
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "TRADE" && req.payload) {
      const { _editedBy: _ignored, ...patch } = req.payload;
      applyExecutionTradeEditFromPayload(req.entityRef, patch, editedBy);
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "OPEN_TRADE_WAREHOUSE" && req.payload) {
      const split = req.payload.warehouseSplit as { warehouseName: string; openQtyMt: number }[] | undefined;
      if (!split?.length) return false;
      applyOpenTradeWarehouseSplit(req.entityRef, split, editedBy, true);
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "LOCKED_CONTRACT_WAREHOUSE" && req.payload) {
      const split = req.payload.warehouseSplit as { warehouseName: string; openQtyMt: number }[] | undefined;
      if (!split?.length) return false;
      allocateContractWarehousesSplit(req.entityRef, split);
      return true;
    }
    if (req.department === "TRADING" && req.entityType === "TRADE" && req.payload) {
      applyTraderTradeEditFromPayload(req.entityRef, req.payload, editedBy);
      return true;
    }
    if (req.entityType === "TRADE" && req.action === "CLOSE") {
      closeLockedContract(req.entityRef, editedBy);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function applyApprovedChangeRequest(
  req: {
    department: Department;
    entityType: string;
    entityRef: string;
    action: string;
    payload?: Record<string, unknown> | null;
  },
  actor: string,
): boolean {
  if (req.action === "CREATE") return applyChangeRequestCreation(req);
  if (req.action === "DELETE") return applyChangeRequestDeletion(req.department, req.entityType, req.entityRef);
  if (req.action === "EDIT") return applyChangeRequestEdit(req, actor);
  if (req.action === "CLOSE") return applyChangeRequestEdit(req, actor);
  return false;
}

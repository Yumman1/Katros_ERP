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

export async function applyChangeRequestDeletion(
  department: Department,
  entityType: string,
  entityRef: string,
): Promise<boolean> {
  try {
    if (department === "EXECUTION") {
      if (entityType === "GATE_ENTRY") return (await deletePendingTruck(entityRef)).ok;
      if (entityType === "INBOUND") return (await deleteInboundReceipt(entityRef)).ok;
      if (entityType === "OUTBOUND") return (await deleteOutboundDispatch(entityRef)).ok;
      if (entityType === "WAREHOUSE") {
        await deleteWarehouseLocation(entityRef);
        return true;
      }
    }
    if (department === "FINANCE" && entityType === "PAYMENT") {
      return (await deletePaymentRequest(entityRef)).ok;
    }
    if (department === "TRADING" && entityType === "TRADE") {
      return (await deleteBookedTrade(entityRef)).ok;
    }
  } catch {
    return false;
  }
  return false;
}

export async function applyChangeRequestCreation(req: {
  department: Department;
  entityType: string;
  payload?: Record<string, unknown> | null;
}): Promise<boolean> {
  try {
    if (req.department === "EXECUTION" && req.entityType === "WAREHOUSE" && req.payload) {
      await addCustomLocation(req.payload as Parameters<typeof addCustomLocation>[0]);
      return true;
    }
    if (req.department === "TRADING" && req.entityType === "COMMODITY" && req.payload) {
      const parsed = commodityCreateInputSchema.safeParse(req.payload);
      if (!parsed.success) return false;
      await addCustomCommodity(parsed.data);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function applyChangeRequestEdit(
  req: {
    department: Department;
    entityType: string;
    entityRef: string;
    payload?: Record<string, unknown> | null;
    action: string;
  },
  editedBy: string,
): Promise<boolean> {
  try {
    // Action-specific trade outcomes come first: a close/cancel request carries
    // a debit-note payload, which the generic "TRADING + TRADE + payload" edit
    // branch below would otherwise swallow and apply as a trade edit.
    if (req.entityType === "TRADE" && req.action === "CLOSE") {
      const { applyCloseChangeRequest } = await import("@/server/trade-closure");
      return applyCloseChangeRequest(req.entityRef, req.payload, editedBy);
    }
    if (req.entityType === "TRADE" && req.action === "CANCEL" && req.payload) {
      const { applyCancellationChangeRequest } = await import("@/server/trade-closure");
      return applyCancellationChangeRequest(req.entityRef, req.payload, editedBy);
    }
    if (req.department === "EXECUTION" && req.entityType === "WAREHOUSE" && req.payload) {
      await updateWarehouseLocation(
        req.entityRef,
        req.payload as Parameters<typeof updateWarehouseLocation>[1],
      );
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "GATE_ENTRY" && req.payload) {
      await updatePendingTruck(req.entityRef, req.payload as Parameters<typeof updatePendingTruck>[1]);
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "INBOUND" && req.payload) {
      await updateInboundReceipt(
        req.entityRef,
        req.payload as Parameters<typeof updateInboundReceipt>[1],
      );
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "OUTBOUND" && req.payload) {
      await updateOutboundDispatch(
        req.entityRef,
        req.payload as Parameters<typeof updateOutboundDispatch>[1],
      );
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "TRADE" && req.payload) {
      const { _editedBy: _ignored, ...patch } = req.payload;
      await applyExecutionTradeEditFromPayload(req.entityRef, patch, editedBy);
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "OPEN_TRADE_WAREHOUSE" && req.payload) {
      const split = req.payload.warehouseSplit as { warehouseName: string; openQtyMt: number }[] | undefined;
      if (!split?.length) return false;
      await applyOpenTradeWarehouseSplit(req.entityRef, split, editedBy, true);
      return true;
    }
    if (req.department === "EXECUTION" && req.entityType === "LOCKED_CONTRACT_WAREHOUSE" && req.payload) {
      const split = req.payload.warehouseSplit as { warehouseName: string; openQtyMt: number }[] | undefined;
      if (!split?.length) return false;
      await allocateContractWarehousesSplit(req.entityRef, split);
      return true;
    }
    if (req.department === "TRADING" && req.entityType === "TRADE" && req.payload) {
      await applyTraderTradeEditFromPayload(req.entityRef, req.payload, editedBy);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function applyApprovedChangeRequest(
  req: {
    department: Department;
    entityType: string;
    entityRef: string;
    action: string;
    payload?: Record<string, unknown> | null;
  },
  actor: string,
): Promise<boolean> {
  if (req.action === "CREATE") return applyChangeRequestCreation(req);
  if (req.action === "DELETE") {
    return applyChangeRequestDeletion(req.department, req.entityType, req.entityRef);
  }
  if (req.action === "EDIT") return applyChangeRequestEdit(req, actor);
  if (req.action === "CLOSE") return applyChangeRequestEdit(req, actor);
  if (req.action === "CANCEL") return applyChangeRequestEdit(req, actor);
  return false;
}

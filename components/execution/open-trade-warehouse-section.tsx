"use client";

import { OpenTradeWarehouseAllocation } from "@/components/execution/open-trade-warehouse-allocation";
import { WarehouseSplitAllocation } from "@/components/execution/warehouse-split-allocation";
import { formatQtyWithUnit } from "@/lib/formatters/numbers";
import type { ExecutionContractView } from "@/server/execution-store";
import { Split } from "lucide-react";
import type { TradeParamValues } from "@/lib/trade-parameters";

type TradeLike = {
  quantity: number;
  quantityUnit?: string | null;
  tradeParams?: TradeParamValues | null;
  warehouseSplitApproved?: boolean;
  pendingWarehouseApproval?: boolean;
  warehouseSplitApprovedBy?: string | null;
};

type CompanyWarehouse = {
  id: string;
  name: string;
  code?: string | null;
};

export function OpenTradeWarehouseSection({
  isLockedMode,
  requiresWarehouse,
  tradeRef,
  trade,
  contract,
  companyWarehouses,
  isExecutionHead,
  isExecutionUser,
}: {
  isLockedMode: boolean;
  requiresWarehouse: boolean;
  tradeRef: string;
  trade: TradeLike | null | undefined;
  contract: ExecutionContractView | null | undefined;
  companyWarehouses: CompanyWarehouse[] | undefined;
  isExecutionHead: boolean;
  isExecutionUser: boolean;
}) {
  if (!requiresWarehouse || !trade) return null;

  if (isLockedMode) {
    if (!contract) {
      return (
        <div className="animate-pulse rounded-xl border border-kastros-border bg-kastros-card p-4 text-sm text-subtle">
          Loading warehouse allocation…
        </div>
      );
    }
    return (
      <section className="rounded-xl border border-kastros-border bg-kastros-card p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Split className="h-4 w-4 text-accent-secondary" />
            <h2 className="text-sm font-semibold text-foreground">Warehouse allocation</h2>
          </div>
        </div>
        <p className="text-xs text-subtle">
          {(contract.receivedQtyMt ?? 0) > 0 ? (
            <>
              <strong className="text-foreground">
                {formatQtyWithUnit(contract.receivedQtyMt ?? 0, contract.quantityUnit, 2)}
              </strong>{" "}
              already fulfilled · split the remaining{" "}
              <strong className="text-foreground">
                {formatQtyWithUnit(contract.openQtyMt ?? 0, contract.quantityUnit, 2)}
              </strong>{" "}
              across warehouses. Quantities already received or dispatched at a warehouse cannot be reduced.
            </>
          ) : (
            <>
              Split the full order{" "}
              <strong className="text-foreground">
                {formatQtyWithUnit(contract.contractualQtyMt, contract.quantityUnit, 2)}
              </strong>{" "}
              across warehouses.
            </>
          )}
        </p>
        <WarehouseSplitAllocation
          contract={contract}
          warehouses={companyWarehouses ?? []}
          editable={isExecutionHead}
          canRequestApproval={isExecutionUser && !isExecutionHead}
          panel
          defaultOpen
        />
      </section>
    );
  }

  return (
    <OpenTradeWarehouseAllocation
      tradeRef={tradeRef}
      contractualQtyMt={trade.quantity}
      quantityUnit={trade.quantityUnit ?? "MT"}
      tradeParams={trade.tradeParams as Record<string, string | number | null> | null | undefined}
      warehouseSplitApproved={trade.warehouseSplitApproved}
      pendingWarehouseApproval={trade.pendingWarehouseApproval}
      warehouseSplitApprovedBy={trade.warehouseSplitApprovedBy}
    />
  );
}

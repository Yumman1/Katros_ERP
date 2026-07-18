-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CEO', 'TRADER', 'EXECUTION', 'RISK_MANAGER', 'FINANCE', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "CommodityCategory" AS ENUM ('GRAINS', 'OILSEEDS', 'SOFTS', 'VEGOIL', 'OTHER');

-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('TRADING_PARTNER', 'BUYER', 'SELLER', 'BROKER', 'BANK');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('VERIFIED', 'PENDING', 'EXPIRED', 'NOT_ON_FILE');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('PORT', 'WAREHOUSE', 'SILO', 'FARM');

-- CreateEnum
CREATE TYPE "TradeDirection" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'LOCKED', 'CONFIRMED', 'EXECUTED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TradeScope" AS ENUM ('LOCAL', 'INTERNATIONAL');

-- CreateEnum
CREATE TYPE "BuyingCategory" AS ENUM ('Delivered', 'Spot');

-- CreateEnum
CREATE TYPE "ExecutionProfile" AS ENUM ('PURCHASE_DELIVERED', 'PURCHASE_SPOT', 'SALE_EX_WAREHOUSE');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DP', 'LC', 'CAD', 'ADVANCE_100', 'CREDIT', 'CREDIT_30', 'AFTER_DELIVERY_100');

-- CreateEnum
CREATE TYPE "ActorSide" AS ENUM ('TRADER', 'EXECUTION', 'CEO');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'TRANSIT', 'DELIVERED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('IN', 'OUT', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('Open', 'Close');

-- CreateEnum
CREATE TYPE "TruckMovementType" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "PendingTruckStatus" AS ENUM ('PENDING', 'ASSIGNED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "InboundReceiptStatus" AS ENUM ('DRAFT', 'ALLOCATED', 'FINANCE_PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "OutboundDispatchStatus" AS ENUM ('AT_GATE', 'WEIGHED', 'FINANCE_PENDING', 'RELEASED');

-- CreateEnum
CREATE TYPE "SpotPurchaseState" AS ENUM ('CONTRACT', 'SELECTED', 'LOADED', 'DC_ISSUED', 'INVOICED', 'FINANCE_PENDING', 'PAID', 'ON_THE_WAY', 'RECEIVED');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentSourceType" AS ENUM ('INBOUND', 'OUTBOUND', 'SPOT');

-- CreateEnum
CREATE TYPE "Department" AS ENUM ('EXECUTION', 'FINANCE', 'TRADING');

-- CreateEnum
CREATE TYPE "ChangeRequestAction" AS ENUM ('CREATE', 'EDIT', 'DELETE', 'CLOSE');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'PENDING_CEO', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('PURCHASE', 'SALES', 'PROVISIONAL', 'FINAL');

-- CreateEnum
CREATE TYPE "CashFlowType" AS ENUM ('TRADE_RECEIPT', 'TRADE_PAYMENT', 'FINANCING', 'FX', 'OVERHEAD', 'OTHER');

-- CreateEnum
CREATE TYPE "ReconType" AS ENUM ('TRADE_VS_INVOICE', 'INVOICE_VS_PAYMENT', 'POSITION_VS_INVENTORY', 'PAYMENT_VS_BANK');

-- CreateEnum
CREATE TYPE "ReconStatus" AS ENUM ('MATCHED', 'BREAK', 'PENDING_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TraceEventType" AS ENUM ('HARVEST', 'PROCESSING', 'STORAGE', 'TRANSPORT', 'SALE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'READ_ONLY',
    "isHead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commodity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "exchange" TEXT,
    "tickerCode" TEXT,
    "category" "CommodityCategory" NOT NULL,
    "canonicalKgPerUnit" DECIMAL(12,4),
    "priceUnits" JSONB,
    "tradeParameterDefs" JSONB,
    "grades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Commodity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitDef" (
    "code" TEXT NOT NULL,
    "label" TEXT,
    "kgPerUnit" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "UnitDef_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Counterparty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CounterpartyType" NOT NULL,
    "country" TEXT NOT NULL,
    "creditLimit" DECIMAL(20,4),
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_ON_FILE',
    "kycRef" TEXT,
    "kycExpires" TIMESTAMP(3),
    "companyNameNtn" TEXT,
    "ntn" TEXT,
    "address" TEXT,
    "bankDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "LocationType" NOT NULL,
    "country" TEXT NOT NULL,
    "lsp" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "capacitySqFt" DECIMAL(14,2),
    "costPerSqFt" DECIMAL(14,4),
    "balesDivisionSqFt" DECIMAL(14,2),
    "grainDivisionSqFt" DECIMAL(14,2),
    "serviceStartDate" TIMESTAMP(3),
    "rentalTaxPkr" DECIMAL(20,2),
    "managementFeePct" DECIMAL(6,3),
    "hiringPeriodMonths" INTEGER,
    "laborLines" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "tradeRef" TEXT NOT NULL,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "desk" TEXT NOT NULL DEFAULT 'Desk A',
    "traderName" TEXT NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "tradeScope" "TradeScope" NOT NULL DEFAULT 'LOCAL',
    "commodityId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "counterpartyKycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_ON_FILE',
    "counterpartyKycRef" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "quantityUnit" TEXT NOT NULL DEFAULT 'MT',
    "quantityEntered" DECIMAL(20,6),
    "quantityEnteredUnit" TEXT,
    "price" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "priceBasis" TEXT NOT NULL DEFAULT 'Fixed',
    "priceCurrency" TEXT,
    "priceWeightUnit" TEXT,
    "priceKgPerUnit" DECIMAL(12,4),
    "pricePerCanonicalQty" DECIMAL(20,6),
    "ratePerMaund" DECIMAL(20,6),
    "ratePerKg" DECIMAL(20,6),
    "commissionAmount" DECIMAL(20,4),
    "commissionPerUnit" DECIMAL(20,6),
    "commissionPerMaund" DECIMAL(20,6),
    "commissionPerCanonicalQty" DECIMAL(20,6),
    "deliveryStart" TIMESTAMP(3) NOT NULL,
    "deliveryEnd" TIMESTAMP(3) NOT NULL,
    "originLocationId" TEXT,
    "destLocationId" TEXT,
    "originName" TEXT NOT NULL DEFAULT '',
    "destName" TEXT NOT NULL DEFAULT '',
    "incoterms" TEXT NOT NULL DEFAULT 'Delivered',
    "buyingCategory" "BuyingCategory",
    "paymentType" "PaymentType" NOT NULL DEFAULT 'CREDIT',
    "paymentTerms" TEXT NOT NULL DEFAULT '',
    "grade" TEXT NOT NULL DEFAULT '',
    "productOrigin" TEXT NOT NULL DEFAULT '',
    "qualityTolerances" TEXT NOT NULL DEFAULT '',
    "qualityTolerancesDetail" JSONB,
    "maxMoisturePct" DECIMAL(6,3),
    "tradeParams" JSONB,
    "marketPrice" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "mtmPnl" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "contractRef" TEXT,
    "tradeStatus" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "executionProfile" "ExecutionProfile",
    "submittedToExecution" BOOLEAN NOT NULL DEFAULT false,
    "submittedToExecutionAt" TIMESTAMP(3),
    "pendingTraderReview" BOOLEAN NOT NULL DEFAULT false,
    "pendingTraderPrice" BOOLEAN NOT NULL DEFAULT false,
    "executionEditNote" TEXT,
    "executionLastEditedBy" TEXT,
    "executionLastEditedAt" TIMESTAMP(3),
    "warehouseSplitApproved" BOOLEAN NOT NULL DEFAULT false,
    "warehouseSplitApprovedAt" TIMESTAMP(3),
    "warehouseSplitApprovedBy" TEXT,
    "pendingWarehouseApproval" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeActivity" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorName" TEXT NOT NULL,
    "actorSide" "ActorSide" NOT NULL,
    "kind" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "note" TEXT,
    "changeCount" INTEGER,
    "changeRequestId" TEXT,
    "payload" JSONB,

    CONSTRAINT "TradeActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPrice" (
    "id" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "priceDate" TIMESTAMP(3) NOT NULL,
    "closePrice" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "MarketPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeskMarketPrice" (
    "id" TEXT NOT NULL,
    "commodityCode" TEXT NOT NULL,
    "cnfAmount" DECIMAL(20,6),
    "cnfCurrency" TEXT,
    "cnfUnit" TEXT,
    "yestAmount" DECIMAL(20,6),
    "yestCurrency" TEXT,
    "yestUnit" TEXT,
    "priceDate" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DeskMarketPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "positionDate" TIMESTAMP(3) NOT NULL,
    "longQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "shortQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "netQty" DECIMAL(20,6) NOT NULL,
    "avgBuyPrice" DECIMAL(20,6),
    "avgSellPrice" DECIMAL(20,6),
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionLeg" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "PositionLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MTMValue" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "valuationDate" TIMESTAMP(3) NOT NULL,
    "marketPrice" DECIMAL(20,6) NOT NULL,
    "bookPrice" DECIMAL(20,6) NOT NULL,
    "mtmPnl" DECIMAL(20,4) NOT NULL,
    "unrealizedPnl" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "MTMValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionAdjustment" (
    "id" TEXT NOT NULL,
    "commodityCode" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL DEFAULT '',
    "deltaMt" DECIMAL(20,6) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "valuationPrice" DECIMAL(20,6) NOT NULL,
    "totalValue" DECIMAL(20,4) NOT NULL,
    "qualityGrade" TEXT,
    "warehouseRef" TEXT,
    "arrivalDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" "InventoryStatus" NOT NULL,
    "reservedQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "inTransitQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT,
    "locationId" TEXT NOT NULL,
    "inventoryId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "shippedAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionContract" (
    "id" TEXT NOT NULL,
    "tradeRef" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "contractDate" TIMESTAMP(3) NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "executionProfile" "ExecutionProfile" NOT NULL,
    "tradeScope" "TradeScope" NOT NULL,
    "incoterms" TEXT NOT NULL,
    "buyingCategory" "BuyingCategory",
    "commodityCode" TEXT NOT NULL,
    "commodityName" TEXT NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "counterpartyCode" TEXT NOT NULL,
    "counterpartyNtn" TEXT,
    "quantityUnit" TEXT NOT NULL,
    "contractualQtyMt" DECIMAL(20,6) NOT NULL,
    "receivedQtyMt" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "openQtyMt" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "contractStatus" "ContractStatus" NOT NULL DEFAULT 'Open',
    "quantityToleranceMt" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "qualityTolerances" JSONB NOT NULL,
    "ratePerMaund" DECIMAL(20,6),
    "ratePerKg" DECIMAL(20,6),
    "unitPrice" DECIMAL(20,6),
    "priceCurrency" TEXT,
    "priceWeightUnit" TEXT,
    "commissionPerMaund" DECIMAL(20,6),
    "currency" TEXT NOT NULL,
    "warehouseDefault" TEXT,
    "traderWarehouseHint" TEXT,
    "traderWarehouseSelections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allocatedWarehouse" TEXT,
    "traderName" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "deliveryStart" TIMESTAMP(3),
    "deliveryEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractWarehouseAllocation" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "locationId" TEXT,
    "qtyMt" DECIMAL(20,6) NOT NULL,
    "fulfilledQtyMt" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractWarehouseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingTruck" (
    "id" TEXT NOT NULL,
    "gatepassNo" TEXT NOT NULL,
    "arrivalDate" TIMESTAMP(3) NOT NULL,
    "movementType" "TruckMovementType" NOT NULL,
    "status" "PendingTruckStatus" NOT NULL DEFAULT 'PENDING',
    "warehouseName" TEXT NOT NULL,
    "truckNo" TEXT NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "commodityCode" TEXT,
    "commodityName" TEXT,
    "recordedByName" TEXT,
    "transporterName" TEXT,
    "transporterPhone" TEXT,
    "builtyDetails" TEXT,
    "quantityAsPerBuilty" TEXT,
    "weightAsPerBuiltyKg" DECIMAL(20,3),
    "weighBridgeName" TEXT,
    "warehouseWeightKg" DECIMAL(20,3),
    "qualitySpecs" JSONB,
    "quantityBagsBales" INTEGER,
    "totalDeductionsKg" DECIMAL(20,3),
    "weightKg" DECIMAL(20,3) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "assignedTradeRef" TEXT,
    "assignedAt" TIMESTAMP(3),
    "remainingKg" DECIMAL(20,3) NOT NULL DEFAULT 0,
    "gateInvoiceNo" TEXT,
    "gateInvoiceWeightKg" DECIMAL(20,3),
    "gateInvoiceQtyMt" DECIMAL(20,6),
    "gateInvoiceAmount" DECIMAL(20,4),
    "gateInvoiceCurrency" TEXT,
    "gateInvoiceRatePerKg" DECIMAL(20,6),
    "gateInvoiceTradeRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingTruck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatepassDocument" (
    "id" TEXT NOT NULL,
    "gatepassNo" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatepassDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundReceipt" (
    "id" TEXT NOT NULL,
    "kcsNo" TEXT NOT NULL,
    "gatepassNo" TEXT,
    "tradeRef" TEXT NOT NULL,
    "receiveDate" TIMESTAMP(3) NOT NULL,
    "truckNo" TEXT NOT NULL,
    "driverName" TEXT,
    "driverCnic" TEXT,
    "driverPhone" TEXT,
    "biltyNo" TEXT NOT NULL,
    "trnNo" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "billNo" TEXT,
    "bags" INTEGER,
    "weightSpotKg" DECIMAL(20,3) NOT NULL,
    "weightWarehouseKg" DECIMAL(20,3) NOT NULL,
    "weightDiffKg" DECIMAL(20,3) NOT NULL,
    "damagePct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "brokenPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "fungusPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "foreignMatterPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "moisturePct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "deductionPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "allocatedQtyMt" DECIMAL(20,6) NOT NULL,
    "fifoOverrideReason" TEXT,
    "amountDue" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "status" "InboundReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentRequestId" TEXT,
    "documentRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundDispatch" (
    "id" TEXT NOT NULL,
    "gatepassNo" TEXT,
    "tradeRef" TEXT NOT NULL,
    "dispatchDate" TIMESTAMP(3) NOT NULL,
    "liftedBy" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "truckNo" TEXT NOT NULL,
    "driverName" TEXT,
    "driverCnic" TEXT,
    "driverPhone" TEXT,
    "dispatchWeightKg" DECIMAL(20,3) NOT NULL,
    "invoiceWeightKg" DECIMAL(20,3) NOT NULL,
    "fungusPct" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "doRef" TEXT,
    "fifoOverrideReason" TEXT,
    "allocatedQtyMt" DECIMAL(20,6) NOT NULL,
    "amountDue" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "status" "OutboundDispatchStatus" NOT NULL DEFAULT 'AT_GATE',
    "paymentRequestId" TEXT,
    "documentRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotPurchaseEvent" (
    "id" TEXT NOT NULL,
    "tradeRef" TEXT NOT NULL,
    "state" "SpotPurchaseState" NOT NULL DEFAULT 'CONTRACT',
    "selectorNotes" TEXT,
    "brokerName" TEXT,
    "dcNo" TEXT,
    "truckNo" TEXT,
    "spotWeightKg" DECIMAL(20,3),
    "brokerInvoiceRef" TEXT,
    "invoiceAmount" DECIMAL(20,4),
    "warehouseReceiveWeightKg" DECIMAL(20,3),
    "weightVarianceKg" DECIMAL(20,3),
    "paymentRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpotPurchaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "requestRef" TEXT NOT NULL,
    "sourceType" "PaymentSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "tradeRef" TEXT NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "financeComment" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "department" "Department" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityRef" TEXT NOT NULL,
    "entityLabel" TEXT NOT NULL,
    "action" "ChangeRequestAction" NOT NULL,
    "comment" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "departmentApprovedByName" TEXT,
    "departmentApprovedAt" TIMESTAMP(3),
    "departmentApprovalNote" TEXT,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceRef" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "quantity" DECIMAL(20,6),
    "currency" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "invoiceType" "InvoiceType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "bankRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashFlowEntry" (
    "id" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3) NOT NULL,
    "entryType" "CashFlowType" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tradeRef" TEXT,
    "invoiceRef" TEXT,
    "isProjected" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "CashFlowEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" TEXT NOT NULL,
    "reconDate" TIMESTAMP(3) NOT NULL,
    "reconType" "ReconType" NOT NULL,
    "referenceA" TEXT NOT NULL,
    "referenceB" TEXT NOT NULL,
    "expectedAmount" DECIMAL(20,4) NOT NULL,
    "actualAmount" DECIMAL(20,4) NOT NULL,
    "difference" DECIMAL(20,4) NOT NULL,
    "status" "ReconStatus" NOT NULL,
    "notes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "valueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bankRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceabilityRecord" (
    "id" TEXT NOT NULL,
    "batchRef" TEXT NOT NULL,
    "commodityId" TEXT NOT NULL,
    "originFarm" TEXT NOT NULL,
    "farmerName" TEXT,
    "farmLocation" TEXT NOT NULL,
    "harvestDate" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "certifications" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TraceabilityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceChainEntry" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "eventType" "TraceEventType" NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "notes" TEXT,
    "documents" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TraceChainEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeTraceabilityLink" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TradeTraceabilityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefCounter" (
    "name" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "RefCounter_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Commodity_code_key" ON "Commodity"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_code_key" ON "Counterparty"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_tradeRef_key" ON "Trade"("tradeRef");

-- CreateIndex
CREATE INDEX "Trade_tradeStatus_direction_idx" ON "Trade"("tradeStatus", "direction");

-- CreateIndex
CREATE INDEX "Trade_commodityId_idx" ON "Trade"("commodityId");

-- CreateIndex
CREATE INDEX "Trade_counterpartyId_idx" ON "Trade"("counterpartyId");

-- CreateIndex
CREATE INDEX "Trade_traderName_idx" ON "Trade"("traderName");

-- CreateIndex
CREATE INDEX "TradeActivity_tradeId_at_idx" ON "TradeActivity"("tradeId", "at");

-- CreateIndex
CREATE INDEX "MarketPrice_commodityId_priceDate_idx" ON "MarketPrice"("commodityId", "priceDate");

-- CreateIndex
CREATE UNIQUE INDEX "DeskMarketPrice_commodityCode_key" ON "DeskMarketPrice"("commodityCode");

-- CreateIndex
CREATE INDEX "Position_positionDate_idx" ON "Position"("positionDate");

-- CreateIndex
CREATE UNIQUE INDEX "Position_commodityId_positionDate_key" ON "Position"("commodityId", "positionDate");

-- CreateIndex
CREATE INDEX "PositionLeg_tradeId_idx" ON "PositionLeg"("tradeId");

-- CreateIndex
CREATE INDEX "MTMValue_tradeId_valuationDate_idx" ON "MTMValue"("tradeId", "valuationDate");

-- CreateIndex
CREATE UNIQUE INDEX "PositionAdjustment_commodityCode_warehouseName_key" ON "PositionAdjustment"("commodityCode", "warehouseName");

-- CreateIndex
CREATE INDEX "Inventory_commodityId_locationId_idx" ON "Inventory"("commodityId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryMovement_inventoryId_movementDate_idx" ON "InventoryMovement"("inventoryId", "movementDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionContract_tradeRef_key" ON "ExecutionContract"("tradeRef");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionContract_tradeId_key" ON "ExecutionContract"("tradeId");

-- CreateIndex
CREATE INDEX "ExecutionContract_contractStatus_executionProfile_idx" ON "ExecutionContract"("contractStatus", "executionProfile");

-- CreateIndex
CREATE INDEX "ExecutionContract_commodityCode_idx" ON "ExecutionContract"("commodityCode");

-- CreateIndex
CREATE INDEX "ContractWarehouseAllocation_warehouseName_idx" ON "ContractWarehouseAllocation"("warehouseName");

-- CreateIndex
CREATE UNIQUE INDEX "ContractWarehouseAllocation_contractId_warehouseName_key" ON "ContractWarehouseAllocation"("contractId", "warehouseName");

-- CreateIndex
CREATE UNIQUE INDEX "PendingTruck_gatepassNo_key" ON "PendingTruck"("gatepassNo");

-- CreateIndex
CREATE INDEX "PendingTruck_status_movementType_idx" ON "PendingTruck"("status", "movementType");

-- CreateIndex
CREATE INDEX "PendingTruck_warehouseName_idx" ON "PendingTruck"("warehouseName");

-- CreateIndex
CREATE INDEX "GatepassDocument_gatepassNo_idx" ON "GatepassDocument"("gatepassNo");

-- CreateIndex
CREATE UNIQUE INDEX "InboundReceipt_kcsNo_key" ON "InboundReceipt"("kcsNo");

-- CreateIndex
CREATE INDEX "InboundReceipt_tradeRef_status_idx" ON "InboundReceipt"("tradeRef", "status");

-- CreateIndex
CREATE INDEX "InboundReceipt_warehouseName_idx" ON "InboundReceipt"("warehouseName");

-- CreateIndex
CREATE INDEX "OutboundDispatch_tradeRef_status_idx" ON "OutboundDispatch"("tradeRef", "status");

-- CreateIndex
CREATE INDEX "OutboundDispatch_warehouseName_idx" ON "OutboundDispatch"("warehouseName");

-- CreateIndex
CREATE UNIQUE INDEX "SpotPurchaseEvent_tradeRef_key" ON "SpotPurchaseEvent"("tradeRef");

-- CreateIndex
CREATE INDEX "SpotPurchaseEvent_state_idx" ON "SpotPurchaseEvent"("state");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_requestRef_key" ON "PaymentRequest"("requestRef");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_sourceType_idx" ON "PaymentRequest"("status", "sourceType");

-- CreateIndex
CREATE INDEX "PaymentRequest_tradeRef_idx" ON "PaymentRequest"("tradeRef");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_department_idx" ON "ChangeRequest"("status", "department");

-- CreateIndex
CREATE INDEX "ChangeRequest_requestedById_idx" ON "ChangeRequest"("requestedById");

-- CreateIndex
CREATE INDEX "ChangeRequest_entityType_entityRef_idx" ON "ChangeRequest"("entityType", "entityRef");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceRef_key" ON "Invoice"("invoiceRef");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "CashFlowEntry_valueDate_idx" ON "CashFlowEntry"("valueDate");

-- CreateIndex
CREATE INDEX "Reconciliation_status_reconDate_idx" ON "Reconciliation"("status", "reconDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankRef_key" ON "BankTransaction"("bankRef");

-- CreateIndex
CREATE INDEX "BankTransaction_valueDate_idx" ON "BankTransaction"("valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "TraceabilityRecord_batchRef_key" ON "TraceabilityRecord"("batchRef");

-- CreateIndex
CREATE INDEX "TraceChainEntry_batchId_eventDate_idx" ON "TraceChainEntry"("batchId", "eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "TradeTraceabilityLink_tradeId_batchId_key" ON "TradeTraceabilityLink"("tradeId", "batchId");

-- AddForeignKey
ALTER TABLE "Commodity" ADD CONSTRAINT "Commodity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_originLocationId_fkey" FOREIGN KEY ("originLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_destLocationId_fkey" FOREIGN KEY ("destLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeActivity" ADD CONSTRAINT "TradeActivity_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeActivity" ADD CONSTRAINT "TradeActivity_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeskMarketPrice" ADD CONSTRAINT "DeskMarketPrice_commodityCode_fkey" FOREIGN KEY ("commodityCode") REFERENCES "Commodity"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionLeg" ADD CONSTRAINT "PositionLeg_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionLeg" ADD CONSTRAINT "PositionLeg_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionLeg" ADD CONSTRAINT "PositionLeg_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MTMValue" ADD CONSTRAINT "MTMValue_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MTMValue" ADD CONSTRAINT "MTMValue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAdjustment" ADD CONSTRAINT "PositionAdjustment_commodityCode_fkey" FOREIGN KEY ("commodityCode") REFERENCES "Commodity"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionContract" ADD CONSTRAINT "ExecutionContract_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractWarehouseAllocation" ADD CONSTRAINT "ContractWarehouseAllocation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ExecutionContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractWarehouseAllocation" ADD CONSTRAINT "ContractWarehouseAllocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingTruck" ADD CONSTRAINT "PendingTruck_assignedTradeRef_fkey" FOREIGN KEY ("assignedTradeRef") REFERENCES "Trade"("tradeRef") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingTruck" ADD CONSTRAINT "PendingTruck_gateInvoiceTradeRef_fkey" FOREIGN KEY ("gateInvoiceTradeRef") REFERENCES "Trade"("tradeRef") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatepassDocument" ADD CONSTRAINT "GatepassDocument_gatepassNo_fkey" FOREIGN KEY ("gatepassNo") REFERENCES "PendingTruck"("gatepassNo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundReceipt" ADD CONSTRAINT "InboundReceipt_gatepassNo_fkey" FOREIGN KEY ("gatepassNo") REFERENCES "PendingTruck"("gatepassNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundReceipt" ADD CONSTRAINT "InboundReceipt_tradeRef_fkey" FOREIGN KEY ("tradeRef") REFERENCES "Trade"("tradeRef") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundReceipt" ADD CONSTRAINT "InboundReceipt_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDispatch" ADD CONSTRAINT "OutboundDispatch_gatepassNo_fkey" FOREIGN KEY ("gatepassNo") REFERENCES "PendingTruck"("gatepassNo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDispatch" ADD CONSTRAINT "OutboundDispatch_tradeRef_fkey" FOREIGN KEY ("tradeRef") REFERENCES "Trade"("tradeRef") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDispatch" ADD CONSTRAINT "OutboundDispatch_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotPurchaseEvent" ADD CONSTRAINT "SpotPurchaseEvent_tradeRef_fkey" FOREIGN KEY ("tradeRef") REFERENCES "Trade"("tradeRef") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotPurchaseEvent" ADD CONSTRAINT "SpotPurchaseEvent_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_tradeRef_fkey" FOREIGN KEY ("tradeRef") REFERENCES "Trade"("tradeRef") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashFlowEntry" ADD CONSTRAINT "CashFlowEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityRecord" ADD CONSTRAINT "TraceabilityRecord_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityRecord" ADD CONSTRAINT "TraceabilityRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceChainEntry" ADD CONSTRAINT "TraceChainEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TraceabilityRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceChainEntry" ADD CONSTRAINT "TraceChainEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTraceabilityLink" ADD CONSTRAINT "TradeTraceabilityLink_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTraceabilityLink" ADD CONSTRAINT "TradeTraceabilityLink_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TraceabilityRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTraceabilityLink" ADD CONSTRAINT "TradeTraceabilityLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


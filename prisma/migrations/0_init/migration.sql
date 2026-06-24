-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TRADER', 'RISK_MANAGER', 'FINANCE', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "CommodityCategory" AS ENUM ('GRAINS', 'OILSEEDS', 'SOFTS', 'VEGOIL', 'OTHER');

-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('BUYER', 'SELLER', 'BROKER', 'BANK');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('PORT', 'WAREHOUSE', 'SILO', 'FARM');

-- CreateEnum
CREATE TYPE "TradeDirection" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('FIXED', 'FLOATING', 'BASIS');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXECUTED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'TRANSIT', 'DELIVERED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('IN', 'OUT', 'TRANSFER', 'ADJUSTMENT');

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Commodity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counterparty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CounterpartyType" NOT NULL,
    "country" TEXT NOT NULL,
    "creditLimit" DECIMAL(20,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "country" TEXT NOT NULL,
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
    "commodityId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "priceType" "PriceType" NOT NULL,
    "deliveryStart" TIMESTAMP(3) NOT NULL,
    "deliveryEnd" TIMESTAMP(3) NOT NULL,
    "originLocationId" TEXT,
    "destLocationId" TEXT,
    "paymentTerms" TEXT NOT NULL,
    "tradeStatus" "TradeStatus" NOT NULL,
    "contractRef" TEXT,
    "desk" TEXT,
    "traderName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Commodity_code_key" ON "Commodity"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_code_key" ON "Counterparty"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_tradeRef_key" ON "Trade"("tradeRef");

-- CreateIndex
CREATE INDEX "MarketPrice_commodityId_priceDate_idx" ON "MarketPrice"("commodityId", "priceDate");

-- CreateIndex
CREATE INDEX "Position_positionDate_idx" ON "Position"("positionDate");

-- CreateIndex
CREATE UNIQUE INDEX "Position_commodityId_positionDate_key" ON "Position"("commodityId", "positionDate");

-- CreateIndex
CREATE INDEX "PositionLeg_tradeId_idx" ON "PositionLeg"("tradeId");

-- CreateIndex
CREATE INDEX "MTMValue_tradeId_valuationDate_idx" ON "MTMValue"("tradeId", "valuationDate");

-- CreateIndex
CREATE INDEX "Inventory_commodityId_locationId_idx" ON "Inventory"("commodityId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryMovement_inventoryId_movementDate_idx" ON "InventoryMovement"("inventoryId", "movementDate");

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
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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


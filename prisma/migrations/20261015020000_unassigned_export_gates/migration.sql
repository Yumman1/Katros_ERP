CREATE TABLE "SesameExportGateIntake" (
 "id" TEXT PRIMARY KEY,
 "warehouseName" TEXT NOT NULL,
 "counterpartyName" TEXT NOT NULL,
 "commodityCode" TEXT NOT NULL,
 "recordedByName" TEXT NOT NULL,
 "payload" JSONB NOT NULL,
 "shipmentId" TEXT REFERENCES "SesameExportShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "assignedAt" TIMESTAMP(3)
);
CREATE INDEX "SesameExportGateIntake_commodityCode_shipmentId_idx" ON "SesameExportGateIntake"("commodityCode","shipmentId");
ALTER TABLE "SesameExportGateIntake" ENABLE ROW LEVEL SECURITY;

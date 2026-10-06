ALTER TABLE "SesameProcessing" ALTER COLUMN "transferId" DROP NOT NULL;
ALTER TABLE "SesameProcessing" ADD COLUMN "planId" TEXT, ADD COLUMN "productionDate" TEXT;
CREATE TABLE "SesameProcessingPlan" (
 "id" TEXT NOT NULL PRIMARY KEY,"requestKey" TEXT NOT NULL UNIQUE,"commodityCode" TEXT NOT NULL,
 "warehouseName" TEXT NOT NULL,"unitName" TEXT NOT NULL,"fromType" TEXT NOT NULL,"toType" TEXT NOT NULL,
 "reservedKg" DECIMAL(20,3) NOT NULL,"remainingKg" DECIMAL(20,3) NOT NULL,
 "dailyCapacityKg" DECIMAL(20,3) NOT NULL,"expectedYieldRatio" DECIMAL(8,6) NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE',"recordedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "processing_quantities" CHECK ("reservedKg">0 AND "remainingKg">=0 AND "remainingKg"<="reservedKg" AND "dailyCapacityKg">0 AND "expectedYieldRatio">=0 AND "expectedYieldRatio"<=1),
 CONSTRAINT "processing_status" CHECK ("status" IN ('ACTIVE','COMPLETED','CANCELLED'))
);
CREATE INDEX "SesameProcessingPlan_commodityCode_warehouseName_status_idx" ON "SesameProcessingPlan"("commodityCode","warehouseName","status");
ALTER TABLE "SesameProcessing" ADD CONSTRAINT "SesameProcessing_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SesameProcessingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SesameProcessingPlan" ENABLE ROW LEVEL SECURITY;

CREATE INDEX "SesameProcessing_planId_productionDate_idx" ON "SesameProcessing"("planId","productionDate");

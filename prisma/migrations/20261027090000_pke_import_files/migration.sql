CREATE TABLE IF NOT EXISTS "PkeImportFile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "purchaseTradeRef" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "stage" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "PkeImportFile_purchaseTradeRef_idx" ON "PkeImportFile"("purchaseTradeRef");
ALTER TABLE "PkeImportFile" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PkeImportFile" FROM anon, authenticated;

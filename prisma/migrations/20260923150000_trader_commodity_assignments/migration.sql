-- CreateTable
CREATE TABLE "CommodityTraderAssignment" (
    "commodityId" TEXT NOT NULL,
    "traderId" TEXT,
    "changedById" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CEO_ASSIGNMENT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommodityTraderAssignment_pkey" PRIMARY KEY ("commodityId")
);

-- CreateIndex
CREATE INDEX "CommodityTraderAssignment_traderId_idx" ON "CommodityTraderAssignment"("traderId");

-- CreateIndex
CREATE INDEX "CommodityTraderAssignment_changedById_idx" ON "CommodityTraderAssignment"("changedById");

-- AddForeignKey
ALTER TABLE "CommodityTraderAssignment" ADD CONSTRAINT "CommodityTraderAssignment_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommodityTraderAssignment" ADD CONSTRAINT "CommodityTraderAssignment_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommodityTraderAssignment" ADD CONSTRAINT "CommodityTraderAssignment_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Server-only access, matching the existing Prisma / NextAuth model.
ALTER TABLE "CommodityTraderAssignment" ENABLE ROW LEVEL SECURITY;

-- One-time initial links. Do not create commodities or users, or infer ownership
-- from historical trades. All other existing commodities are visibly unassigned.
INSERT INTO "CommodityTraderAssignment" ("commodityId", "traderId", "source", "version", "updatedAt")
SELECT c."id", u."id", 'INITIAL_SETUP', 1, CURRENT_TIMESTAMP
FROM "Commodity" c
LEFT JOIN "User" u ON lower(u."email") = CASE
  WHEN upper(trim(c."code")) IN ('SES', 'SESAME') OR trim(c."name") ~* '^sesame( seeds?)?$'
    THEN 'saad.bashir@kastros.co'
  WHEN upper(trim(c."code")) = 'CRN' OR upper(trim(c."code")) LIKE 'CORN%'
    THEN 'fahad.ahmed@kastros.co'
  ELSE NULL
END AND u."role" = 'TRADER' AND u."disabled" = false
ON CONFLICT ("commodityId") DO NOTHING;

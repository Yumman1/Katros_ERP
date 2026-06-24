import type { Commodity } from "@prisma/client";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { isMockMode } from "@/server/mock-mode";
import { mockCommodityList } from "@/server/dummy-data";

export const commodityRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    if (isMockMode()) return mockCommodityList() as unknown as Commodity[];
    return ctx.prisma.commodity.findMany({ orderBy: { code: "asc" } });
  }),
});

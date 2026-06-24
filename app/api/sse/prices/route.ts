import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { isMockMode } from "@/server/mock-mode";
import { mockPriceTickerPayload } from "@/server/dummy-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE heartbeat + latest snapshot of headline commodity prices for ticker UI. */
export async function GET() {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = async () => {
        const payload = isMockMode()
          ? mockPriceTickerPayload()
          : await (async () => {
              const commodities = await prisma.commodity.findMany({ orderBy: { code: "asc" } });
              return Promise.all(
                commodities.map(async (c) => {
                  const p = await prisma.marketPrice.findFirst({
                    where: { commodityId: c.id },
                    orderBy: { priceDate: "desc" },
                  });
                  return {
                    code: c.code,
                    price: p ? Number(p.closePrice) : 0,
                    ccy: p?.currency ?? "USD",
                    asOf: p?.priceDate.toISOString() ?? new Date().toISOString(),
                  };
                }),
              );
            })();
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      await send();
      setInterval(send, 30_000);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

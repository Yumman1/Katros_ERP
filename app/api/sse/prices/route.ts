import { NextResponse } from "next/server";
import { marketTickerPayload } from "@/server/market-prices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE heartbeat — execution desk CNF prices only (no external feeds). */
export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = () => {
        const payload = marketTickerPayload();
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      send();
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

import { NextResponse } from "next/server";
import { marketTickerPayload } from "@/server/market-prices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE heartbeat — execution desk CNF prices only (no external feeds). */
export async function GET() {
  let intervalId: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

      const send = async () => {
        if (closed) return;
        try {
          const payload = await marketTickerPayload();
          if (closed) return;
          controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
          if (intervalId) clearInterval(intervalId);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      void send();
      intervalId = setInterval(() => void send(), 30_000);
    },
    cancel() {
      closed = true;
      if (intervalId) clearInterval(intervalId);
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

import { snapshot, subscribe, type LiveEvent } from "@/lib/live/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events carrying live readings to every open tab. Chosen over a
 * WebSocket because it needs no extra server, no dependency, and reconnects on
 * its own if the dev server restarts mid-demo.
 */
export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;

      const send = (event: LiveEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };

      // Catch the new tab up on everything heard so far.
      send({ type: "snapshot", readings: snapshot() });

      const unsubscribe = subscribe(send);

      // Proxies and browsers drop an idle event stream; a comment every 20 s
      // keeps it alive without showing up as an event.
      const keepAlive = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          open = false;
        }
      }, 20_000);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops nginx-style buffering from holding events back.
      "X-Accel-Buffering": "no",
    },
  });
}

import type { NextRequest } from "next/server";
import { z } from "zod";
import { ask, type AskEvent } from "@/lib/assistant/run";

const AskBody = z.object({ question: z.string().trim().min(2).max(2000) });

// Streams newline-delimited JSON events so the UI can show graph steps as they happen.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/patients/[id]/ask">) {
  const { id } = await ctx.params;
  const body = AskBody.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "Ask a question first." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AskEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await ask(id, body.data.question, emit);
      } catch (err) {
        console.error("[ask]", err);
        emit({ type: "error", message: err instanceof Error ? err.message : "Something went wrong answering that." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

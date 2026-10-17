import type { NextRequest } from "next/server";
import { z } from "zod";
import { getMemory } from "@/lib/memory/client";

const NoteBody = z.object({
  text: z.string().trim().min(2).max(1000),
  kind: z.enum(["observation", "event", "preference"]).default("observation"),
  author: z.string().max(80).optional(),
});

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/patients/[id]/notes">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await getMemory().listNotes(id));
  } catch (err) {
    return Response.json({ error: `Memory is unavailable: ${String(err)}` }, { status: 503 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/patients/[id]/notes">) {
  const { id } = await ctx.params;
  const body = NoteBody.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "Write a note of at least a couple of words." }, { status: 400 });
  try {
    return Response.json(await getMemory().addNote(id, body.data));
  } catch (err) {
    return Response.json({ error: `The note wasn't saved: ${String(err)}` }, { status: 503 });
  }
}

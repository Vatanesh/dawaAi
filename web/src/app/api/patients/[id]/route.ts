import type { NextRequest } from "next/server";
import { getRepository } from "@/lib/graph/repository";
import { getMemory } from "@/lib/memory/client";
import { PatientBody } from "../schema";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/patients/[id]">) {
  const { id } = await ctx.params;
  const body = PatientBody.partial().safeParse(await req.json());
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Check the details." }, { status: 400 });
  const repo = await getRepository();
  await repo.updatePatient(id, body.data);
  return Response.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/patients/[id]">) {
  const { id } = await ctx.params;
  const repo = await getRepository();
  // Memory first: its entities point at the Patient node, which the graph delete removes.
  try {
    await getMemory().forget(id);
  } catch (err) {
    return Response.json({ error: `Memory couldn't be erased, so nothing was deleted: ${String(err)}` }, { status: 503 });
  }
  await repo.deletePatient(id);
  return Response.json({ ok: true });
}

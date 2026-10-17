import type { NextRequest } from "next/server";
import { getMemory, softly } from "@/lib/memory/client";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/patients/[id]/chat">) {
  const { id } = await ctx.params;
  return Response.json(await softly(() => getMemory().chatHistory(id, 30), []));
}

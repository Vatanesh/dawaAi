import type { NextRequest } from "next/server";
import { getRepository } from "@/lib/graph/repository";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const repo = await getRepository();
  return Response.json(q.trim() ? await repo.searchMedications(q, 8) : []);
}

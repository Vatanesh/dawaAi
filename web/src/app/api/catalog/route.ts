import { connection } from "next/server";
import { getRepository } from "@/lib/graph/repository";

// Pick-lists for patient forms: conditions (with ICD-10) and the foods the graph knows about.
export async function GET() {
  await connection();
  const repo = await getRepository();
  const [conditions, foods] = await Promise.all([repo.listConditions(), repo.listFoods()]);
  return Response.json({ conditions, foods });
}

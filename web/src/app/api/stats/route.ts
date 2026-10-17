import { connection } from "next/server";
import { getStats } from "@/lib/graph/stats";

// Live size of the knowledge graph and of the work done with it, for the About page.
export async function GET() {
  await connection();
  return Response.json(await getStats());
}

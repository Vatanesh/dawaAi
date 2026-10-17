import { connection } from "next/server";
import { aiProvider, checkRouterKey, routerIssue, routerModels } from "@/lib/assistant/llm";
import { getRepository } from "@/lib/graph/repository";
import { getMemory } from "@/lib/memory/client";

export async function GET() {
  await connection();
  const repo = await getRepository();
  const ai = aiProvider();
  if (ai === "router") await checkRouterKey();
  return Response.json({
    graph: repo.source,
    memory: getMemory().mode,
    ai,
    model: ai === "router" ? routerModels()[0] : ai === "claude" ? "claude-opus-5-5" : null,
    aiIssue: ai === "router" ? (routerIssue() ?? null) : null,
  });
}

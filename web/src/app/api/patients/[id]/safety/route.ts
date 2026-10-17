import type { NextRequest } from "next/server";
import { getMemory, softly } from "@/lib/memory/client";
import { medLabel } from "@/lib/safety/engine";
import { checkSafety } from "@/lib/safety/service";
import { SLOTS, type Slot } from "@/lib/types";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/patients/[id]/safety">) {
  const { id } = await ctx.params;
  const candidate = req.nextUrl.searchParams.get("candidate");
  const slots = (req.nextUrl.searchParams.get("slots") ?? "")
    .split(",")
    .filter((s): s is Slot => SLOTS.includes(s as Slot));
  const result = await checkSafety(id, candidate ? { medicationId: candidate, slots } : undefined);
  if (!result) return Response.json({ error: "Patient not found" }, { status: 404 });

  // What-if checks go to the audit trail (reasoning memory); plain page loads don't.
  const trialled = result.report.candidate;
  if (trialled) {
    const mine = result.report.findings.filter((f) => f.involvesCandidate);
    void softly(
      () =>
        getMemory().addTrace({
          patientId: id,
          task: `What-if: add ${medLabel(trialled)}`,
          outcome: `${result.report.verdict}: ${mine.length} new findings (${mine.filter((f) => f.severity === "major").length} serious)`,
          success: true,
          steps: mine.slice(0, 8).map((f) => ({
            action: f.title,
            observation: `${f.severity}: ${f.recommendation}`,
            tool: { name: "graph.path", arguments: { path: f.path.map((n) => `${n.label}:${n.name}`).join(" -> ") } },
          })),
        }),
      undefined,
    );
  }
  return Response.json(result);
}

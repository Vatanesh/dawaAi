import type { NextRequest } from "next/server";
import { getRepository } from "@/lib/graph/repository";
import { getMemory, softly } from "@/lib/memory/client";
import { checkSafety } from "@/lib/safety/service";

// Applies the optimiser's suggested schedule. Recomputed server-side so the client can't move
// anything the optimiser wouldn't (prescription timing is never changed).
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/patients/[id]/schedule">) {
  const { id } = await ctx.params;
  const res = await checkSafety(id);
  if (!res) return Response.json({ error: "Patient not found" }, { status: 404 });
  const repo = await getRepository();
  for (const move of res.schedule.moves) {
    const item = res.context.regimen.find((r) => r.medication.id === move.medicationId);
    if (!item) continue;
    await repo.addToRegimen(id, {
      medicationId: move.medicationId,
      dose: item.dose,
      slots: move.to,
      prescriber: item.prescriber,
      purpose: item.purpose,
    });
  }
  void softly(
    () =>
      getMemory().addTrace({
        patientId: id,
        task: "Applied the suggested medicine schedule",
        outcome: `${res.schedule.moves.length} moved; timing clashes ${res.schedule.clashesBefore} → ${res.schedule.clashesAfter}`,
        success: true,
        steps: res.schedule.moves.map((m) => ({ action: `Moved ${m.name}`, observation: `${m.from.join("/")} → ${m.to.join("/")}: ${m.reason}` })),
      }),
    undefined,
  );
  return Response.json({ moved: res.schedule.moves.length });
}

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/graph/repository";
import { getMemory, softly } from "@/lib/memory/client";
import { SLOTS, type Slot } from "@/lib/types";

const AddBody = z.object({
  medicationId: z.string().min(1),
  dose: z.string().trim().min(1).max(120),
  slots: z.array(z.enum(SLOTS as [Slot, ...Slot[]])).min(1),
  prescriber: z.string().trim().max(120).optional(),
  purpose: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest, ctx: RouteContext<"/api/patients/[id]/regimen">) {
  const { id } = await ctx.params;
  const body = AddBody.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "Choose a medicine, a dose and at least one time of day." }, { status: 400 });
  const repo = await getRepository();
  const med = await repo.getMedication(body.data.medicationId);
  if (!med) return Response.json({ error: "That medicine isn't in the graph." }, { status: 404 });
  // A DrugBank search result resolves to a real Medication id here.
  await repo.addToRegimen(id, { ...body.data, medicationId: med.id });
  void softly(
    () =>
      getMemory().addTrace({
        patientId: id,
        task: `Added ${med.name} to the regimen`,
        outcome: `${body.data.dose}; ${body.data.slots.join(", ")}`,
        success: true,
        steps: [{ action: "Regimen updated", observation: `Prescriber: ${body.data.prescriber || "not recorded"}` }],
      }),
    undefined,
  );
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/patients/[id]/regimen">) {
  const { id } = await ctx.params;
  const medicationId = req.nextUrl.searchParams.get("medicationId");
  if (!medicationId) return Response.json({ error: "medicationId is required" }, { status: 400 });
  const repo = await getRepository();
  const med = await repo.getMedication(medicationId);
  await repo.removeFromRegimen(id, medicationId);
  void softly(
    () =>
      getMemory().addTrace({
        patientId: id,
        task: `Removed ${med?.name ?? medicationId} from the regimen`,
        outcome: "Regimen updated",
        success: true,
        steps: [],
      }),
    undefined,
  );
  return Response.json({ ok: true });
}

import { getRepository } from "../graph/repository";
import type { RegimenItem, SafetyResponse, Slot } from "../types";
import { analyse, buildGraphView } from "./engine";
import { planSchedule } from "./schedule";

export interface CandidateInput {
  medicationId: string;
  slots?: Slot[];
  dose?: string;
}

/**
 * Full safety check for a patient, optionally trialling medicines they don't take yet.
 * Several candidates are checked together (against the regimen and against each other).
 */
export async function checkSafety(patientId: string, input?: CandidateInput | CandidateInput[]): Promise<SafetyResponse | null> {
  const repo = await getRepository();
  const context = await repo.getPatientContext(patientId);
  if (!context) return null;

  const inputs = input ? (Array.isArray(input) ? input : [input]) : [];
  const candidates: RegimenItem[] = [];
  for (const c of inputs) {
    const medication = await repo.getMedication(c.medicationId);
    if (medication) candidates.push({ medication, dose: c.dose ?? "Dose not set", slots: c.slots ?? [], prescriber: "Being considered" });
  }

  const items = [...context.regimen, ...candidates];
  const ingredientIds = [...new Set(items.flatMap((i) => i.medication.ingredients.map((x) => x.id)))];
  const knowledge = await repo.getKnowledge(
    ingredientIds,
    context.patient.conditions.map((c) => c.id),
  );
  const report = analyse(context, knowledge, candidates);
  // Timing plan for the medicines actually taken; medicines under consideration aren't moved.
  const schedule = planSchedule(context.regimen, knowledge, report.findings.filter((f) => !f.involvesCandidate));
  return { context, report, graph: buildGraphView(context, report, candidates), schedule, source: repo.source };
}

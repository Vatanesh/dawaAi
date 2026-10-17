import { connection } from "next/server";
import { getRepository } from "@/lib/graph/repository";
import { checkSafety } from "@/lib/safety/service";
import type { PatientOverview } from "@/lib/types";

// Care-team triage: every patient's risk at a glance, most urgent first.
export async function GET() {
  await connection();
  const repo = await getRepository();
  const patients = await repo.listPatients();
  const rows = await Promise.all(
    patients.map(async (p): Promise<PatientOverview | null> => {
      const res = await checkSafety(p.id);
      if (!res) return null;
      const top = res.report.findings.find((f) => f.severity !== "minor") ?? res.report.findings[0];
      return {
        ...p,
        verdict: res.report.verdict,
        counts: res.report.counts,
        top: top && { title: top.title, severity: top.severity },
        prescribers: new Set(res.context.regimen.map((r) => r.prescriber).filter((x) => x?.startsWith("Dr"))).size,
        conditions: res.context.patient.conditions.map((c) => c.name),
        timingClashes: res.schedule.clashesBefore + res.schedule.tips.length,
      };
    }),
  );
  const rank = { danger: 0, caution: 1, clear: 2 } as const;
  return Response.json(
    rows
      .filter((r): r is PatientOverview => !!r)
      .sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.counts.major - a.counts.major || b.counts.moderate - a.counts.moderate),
  );
}

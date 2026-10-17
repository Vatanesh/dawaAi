"use client";

import { Printer } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { brand } from "@/brand";
import { Button } from "@/components/ui/button";
import { useNotes, useSafety } from "@/lib/client/api";
import { KIND_LABEL, SEVERITY, SLOT_LABEL } from "@/lib/client/ui";
import { medLabel } from "@/lib/safety/engine";
import { SLOTS } from "@/lib/types";

/** One-page summary to hand to a doctor or pharmacist: the whole list, the risks and the timing plan. */
export function Report() {
  const id = useSearchParams().get("p") ?? undefined;
  const { data, error } = useSafety(id);
  const { data: notes } = useNotes(id);

  if (!id) return <p className="p-8">No person selected.</p>;
  if (error) return <p className="p-8 text-destructive">{error.message}</p>;
  if (!data) return <p className="p-8 text-muted-foreground">Preparing report…</p>;

  const { context, report, schedule } = data;
  const p = context.patient;
  const important = report.findings.filter((f) => f.severity !== "minor");
  const minor = report.findings.filter((f) => f.severity === "minor");

  return (
    <div className="mx-auto max-w-[820px] bg-background px-6 py-8 text-[13px] leading-relaxed print:max-w-none print:px-0 print:py-0">
      <div className="no-print mb-6 flex justify-end">
        <Button onClick={() => window.print()}>
          <Printer /> Print or save as PDF
        </Button>
      </div>

      <header className="flex items-start justify-between border-b pb-4">
        <div>
          <p className="text-xs font-semibold text-primary">{brand.name} medication report</p>
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <p className="text-muted-foreground">
            {p.age} years{p.sex ? `, ${p.sex}` : ""}. Conditions: {p.conditions.map((c) => `${c.name}${c.icd10 ? ` (${c.icd10})` : ""}`).join(", ") || "none recorded"}.
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>Prepared {new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</p>
          <p>
            {report.counts.major} serious · {report.counts.moderate} moderate · {report.counts.minor} minor
          </p>
        </div>
      </header>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-bold">Current medicines ({context.regimen.length})</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Medicine</th>
              <th className="py-1.5 pr-2 font-medium">Dose</th>
              <th className="py-1.5 pr-2 font-medium">When</th>
              <th className="py-1.5 font-medium">Prescriber</th>
            </tr>
          </thead>
          <tbody>
            {context.regimen.map((r) => (
              <tr key={r.medication.id} className="border-b align-top">
                <td className="py-1.5 pr-2 font-medium">
                  {medLabel(r.medication)}
                  <span className="block text-xs font-normal text-muted-foreground">{r.medication.ingredients.map((i) => i.name).join(", ")}</span>
                </td>
                <td className="py-1.5 pr-2">{r.dose}</td>
                <td className="py-1.5 pr-2">{r.slots.map((s) => SLOT_LABEL[s].name).join(", ") || "As needed"}</td>
                <td className="py-1.5">{r.prescriber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-5 break-inside-avoid">
        <h2 className="mb-2 text-sm font-bold">To discuss ({important.length})</h2>
        {important.length === 0 && <p className="text-muted-foreground">No serious or moderate interactions found.</p>}
        <ol className="space-y-2">
          {important.map((f) => (
            <li key={f.id} className="break-inside-avoid">
              <p className="font-semibold">
                <span className={SEVERITY[f.severity].text}>{SEVERITY[f.severity].label}</span> · {KIND_LABEL[f.kind]}: {f.title}
              </p>
              <p className="text-muted-foreground">{f.detail}</p>
              <p>Suggested: {f.recommendation}</p>
              <p className="text-[11px] text-muted-foreground">
                Source: {f.source === "drugbank" ? "DrugBank (severity estimated)" : f.path.some((n) => n.label === "DrugClass") ? "curated drug-class rule (WHO ATC)" : "curated"}.
                Graph: {f.path.map((n, i) => `${n.name}${n.rel && i < f.path.length - 1 ? ` -[:${n.rel}]- ` : ""}`).join("")}
                {f.evidence ? ` DrugBank: “${f.evidence}”` : ""}
              </p>
            </li>
          ))}
        </ol>
        {important.some((f) => f.source === "drugbank") && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Items marked DrugBank have no published severity grade; {brand.name} estimates them from the wording and caps them at moderate.
          </p>
        )}
      </section>

      {(schedule.moves.length > 0 || schedule.tips.length > 0) && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="mb-2 text-sm font-bold">Timing</h2>
          <ul className="list-disc space-y-1 pl-5">
            {schedule.moves.map((m) => (
              <li key={m.medicationId}>
                Move {m.name} from {m.from.join("/")} to {m.to.join("/")}: {m.reason}
              </li>
            ))}
            {schedule.tips.map((t) => (
              <li key={t.findingId}>{t.text}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5 break-inside-avoid">
        <h2 className="mb-2 text-sm font-bold">Daily plan</h2>
        <div className="grid grid-cols-4 gap-2">
          {SLOTS.map((s) => (
            <div key={s} className="rounded-lg border p-2">
              <p className="text-xs font-semibold">
                {SLOT_LABEL[s].name} <span className="font-normal text-muted-foreground">{SLOT_LABEL[s].time}</span>
              </p>
              <ul className="mt-1 text-xs">
                {context.regimen
                  .filter((r) => r.slots.includes(s))
                  .map((r) => (
                    <li key={r.medication.id}>{r.medication.name}</li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {minor.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="mb-1 text-sm font-bold">Also noted (minor)</h2>
          <p className="text-muted-foreground">{minor.map((f) => f.title).join("; ")}.</p>
        </section>
      )}

      {notes && notes.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="mb-1 text-sm font-bold">Caregiver notes</h2>
          <ul className="list-disc space-y-0.5 pl-5">
            {notes.slice(0, 6).map((n) => (
              <li key={n.id}>
                {n.text} <span className="text-muted-foreground">({new Date(n.createdAt).toLocaleDateString()})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t pt-3 text-[11px] text-muted-foreground">
        Generated from the {brand.name} medication knowledge graph (curated interactions, WHO ATC drug classes, DrugBank). Decision support only; it does not replace
        clinical judgement.{brand.partner ? ` Provided by ${brand.partner}.` : ""}
      </footer>
    </div>
  );
}

"use client";

import { AlertTriangle, CheckCircle2, Plus, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";
import { ScoreRing, SeverityDot } from "@/components/common/bits";
import { Pill } from "@/components/common/Pill";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { refreshPatient, send } from "@/lib/client/api";
import { safetyScore, SLOT_LABEL } from "@/lib/client/ui";
import { SLOTS, type SafetyResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FindingRow } from "./FindingRow";

export function OverviewTab({ data }: { data: SafetyResponse }) {
  const app = useApp();
  const { context, report, schedule } = data;
  const trial = !!report.candidate;
  const scoped = trial ? report.findings.filter((f) => f.involvesCandidate) : report.findings;
  const counts = { major: 0, moderate: 0, minor: 0 };
  for (const f of report.findings) counts[f.severity]++;
  const attention = scoped.filter((f) => f.severity !== "minor");
  const nutrients = report.findings.filter((f) => f.kind === "nutrient");
  const verdictCopy =
    report.verdict === "danger"
      ? `${counts.major} serious ${counts.major === 1 ? "issue" : "issues"} to raise with a doctor`
      : report.verdict === "caution"
        ? `No serious issues; ${counts.moderate} to keep an eye on`
        : "Nothing that needs action";

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="gap-4" data-tour="score">
        <CardHeader>
          <CardTitle>DawaAI score</CardTitle>
          <CardDescription>
            {trial ? "Including the medicine being checked. " : ""}
            Serious issues weigh most (−18 each), moderate −5, minor −0.5; DrugBank-estimated items included.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-5">
          <ScoreRing score={safetyScore(counts)} verdict={report.verdict} />
          <div className="min-w-0 space-y-2">
            <p className="text-sm leading-snug font-semibold">{verdictCopy}</p>
            <dl className="space-y-1 text-xs">
              {(["major", "moderate", "minor"] as const).map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <SeverityDot severity={s} />
                  <dt className="w-16 text-muted-foreground">{s === "major" ? "Serious" : s === "moderate" ? "Moderate" : "Minor"}</dt>
                  <dd className="font-semibold tabular-nums">{counts[s]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-2 lg:col-span-2" data-tour="attention">
        <CardHeader>
          <CardTitle>{trial ? "What this medicine would change" : "Needs attention"}</CardTitle>
          <CardDescription>{attention.length ? `${attention.length} serious or moderate` : trial ? "It adds no serious or moderate issues" : "No serious or moderate issues"}</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => app.setTab("interactions")}>
              View all {scoped.length}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-2">
          {attention.length ? (
            <div className="space-y-0.5">
              {attention.slice(0, 5).map((f) => (
                <FindingRow key={f.id} finding={f} showNew={trial} />
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 px-2.5 py-4 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-clear" /> Nothing to act on right now.
            </p>
          )}
        </CardContent>
      </Card>

      <TodayCard data={data} />

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>Medicines</CardTitle>
          <CardDescription>{context.regimen.length} on the list</CardDescription>
          <CardAction>
            <Button variant="ghost" size="icon-sm" aria-label="Add a medicine" onClick={() => app.openCommand("check")}>
              <Plus />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-2">
          <ul>
            {context.regimen.slice(0, 7).map((r) => (
              <li key={r.medication.id}>
                <button
                  type="button"
                  onClick={() => app.openMedicineDialog(r)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-muted"
                >
                  <Pill medication={r.medication} />
                  <span className="min-w-0 flex-1 truncate text-sm">{r.medication.name}</span>
                  <span className="text-xs text-muted-foreground">{r.slots.map((s) => SLOT_LABEL[s].short).join(" · ") || "As needed"}</span>
                </button>
              </li>
            ))}
          </ul>
          {context.regimen.length > 7 && (
            <Button variant="link" size="sm" className="px-2.5" onClick={() => app.setTab("schedule")}>
              {context.regimen.length - 7} more
            </Button>
          )}
          {schedule && context.regimen.length === 0 && (
            <p className="px-2.5 py-3 text-sm text-muted-foreground">No medicines yet. Use “Check a medicine” to add the first one.</p>
          )}
        </CardContent>
      </Card>

      <Card className="gap-3 lg:col-span-3">
        <CardHeader>
          <CardTitle>Nutrients and food</CardTitle>
          <CardDescription>What the medicines drain, and foods that clash with them</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Nutrients to monitor</p>
            <div className="flex flex-wrap gap-1.5">
              {nutrients.length === 0 && <span className="text-sm text-muted-foreground">None flagged</span>}
              {nutrients.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => app.openFinding(f)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  <SeverityDot severity={f.severity} />
                  {f.path[f.path.length - 1].name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Foods to be careful with</p>
            <div className="flex flex-wrap gap-1.5">
              {report.watchFoods.length === 0 && <span className="text-sm text-muted-foreground">None flagged</span>}
              {[...new Map(report.watchFoods.map((e) => [e.food.id, e])).values()].map((e) => (
                <span
                  key={e.food.id}
                  title={`${e.ingredient.name}: ${e.recommendation}`}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                >
                  <SeverityDot severity={e.severity} />
                  {e.food.name}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TodayCard({ data }: { data: SafetyResponse }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const { context, report, schedule } = data;
  const trialItem = report.candidate && app.trial ? { medication: report.candidate, slots: app.trial.slots } : null;
  const clashIds = new Set(report.findings.filter((f) => f.kind === "timing" && f.severity !== "minor").flatMap((f) => f.medicationIds));

  const apply = async () => {
    setBusy(true);
    try {
      const { moved } = await send<{ moved: number }>(`/api/patients/${context.patient.id}/schedule`);
      toast.success(`Schedule updated: ${moved} ${moved === 1 ? "medicine" : "medicines"} re-timed`);
      await refreshPatient(context.patient.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The schedule wasn't updated");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 lg:col-span-2" data-tour="today">
      <CardHeader>
        <CardTitle>Today</CardTitle>
        <CardDescription>
          {schedule.clashesBefore || schedule.tips.length ? `${schedule.clashesBefore + schedule.tips.length} timing ${schedule.clashesBefore + schedule.tips.length === 1 ? "issue" : "issues"}` : "Doses are well spaced"}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => app.setTab("schedule")}>
            Full schedule
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SLOTS.map((slot) => {
            const meds = context.regimen.filter((r) => r.slots.includes(slot));
            const habits = context.habits.filter((h) => h.slot === slot);
            const clash = meds.some((m) => clashIds.has(m.medication.id));
            return (
              <div key={slot} className={cn("rounded-lg border p-2.5", clash ? "border-moderate/50 bg-moderate-wash/40" : "bg-muted/40")}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-xs font-semibold">{SLOT_LABEL[slot].name}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{SLOT_LABEL[slot].time}</span>
                </div>
                <ul className="space-y-1">
                  {meds.map((m) => (
                    <li key={m.medication.id} className="flex items-center gap-1.5 text-xs">
                      <Pill medication={m.medication} size={14} />
                      <span className="truncate">{m.medication.name}</span>
                    </li>
                  ))}
                  {trialItem?.slots.includes(slot) && (
                    <li className="flex items-center gap-1.5 text-xs text-primary italic">
                      <Pill medication={trialItem.medication} size={14} dashed />
                      <span className="truncate">{trialItem.medication.name}</span>
                    </li>
                  )}
                  {habits.map((h) => (
                    <li key={h.food.id} className="truncate pl-5 text-[11px] text-muted-foreground">
                      {h.food.name}
                    </li>
                  ))}
                  {!meds.length && !habits.length && !trialItem?.slots.includes(slot) && <li className="text-[11px] text-muted-foreground">Nothing</li>}
                </ul>
              </div>
            );
          })}
        </div>
        {(schedule.moves.length > 0 || schedule.tips.length > 0) && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent px-3 py-2">
            {schedule.moves.length > 0 ? <Wand2 className="size-4 text-accent-foreground" /> : <AlertTriangle className="size-4 text-moderate" />}
            <p className="min-w-0 flex-1 text-sm">
              {schedule.moves.length > 0
                ? `Suggested: ${schedule.moves.map((m) => `move ${m.name} to ${m.to.map((s) => SLOT_LABEL[s].name.toLowerCase()).join(" and ")}`).join("; ")}.`
                : schedule.tips[0].text}
            </p>
            {schedule.moves.length > 0 && (
              <Button size="sm" disabled={busy} onClick={() => void apply()}>
                Apply
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

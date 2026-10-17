"use client";

import { ArrowRight, Info, MoreHorizontal, Pencil, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";
import { Pill } from "@/components/common/Pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { refreshPatient, send } from "@/lib/client/api";
import { SLOT_LABEL } from "@/lib/client/ui";
import { medLabel } from "@/lib/safety/engine";
import { SLOTS, type RegimenItem, type SafetyResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ScheduleTab({ data }: { data: SafetyResponse }) {
  const app = useApp();
  const { context, report, schedule } = data;
  const [busy, setBusy] = useState(false);
  const clash = new Set(report.findings.filter((f) => f.kind === "timing" && f.severity !== "minor").flatMap((f) => f.medicationIds));
  const moving = new Map(schedule.moves.map((m) => [m.medicationId, m]));

  const apply = async () => {
    setBusy(true);
    try {
      const { moved } = await send<{ moved: number }>(`/api/patients/${context.patient.id}/schedule`);
      toast.success(`Schedule updated: ${moved} re-timed`);
      await refreshPatient(context.patient.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The schedule wasn't updated");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: RegimenItem) => {
    await send(`/api/patients/${context.patient.id}/regimen?medicationId=${encodeURIComponent(r.medication.id)}`, undefined, "DELETE");
    toast.success(`${r.medication.name} removed`, {
      action: {
        label: "Undo",
        onClick: () =>
          void send(`/api/patients/${context.patient.id}/regimen`, {
            medicationId: r.medication.id,
            dose: r.dose,
            slots: r.slots.length ? r.slots : ["morning"],
            prescriber: r.prescriber,
            purpose: r.purpose,
          }).then(() => refreshPatient(context.patient.id)),
      },
    });
    await refreshPatient(context.patient.id);
  };

  const byPrescriber = new Map<string, RegimenItem[]>();
  for (const r of context.regimen) byPrescriber.set(r.prescriber || "Not recorded", [...(byPrescriber.get(r.prescriber || "Not recorded") ?? []), r]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {SLOTS.map((slot) => {
          const meds = context.regimen.filter((r) => r.slots.includes(slot));
          const habits = context.habits.filter((h) => h.slot === slot);
          return (
            <Card key={slot} className={cn("gap-2 p-3", meds.some((m) => clash.has(m.medication.id)) && "ring-moderate/50")}>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{SLOT_LABEL[slot].name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{SLOT_LABEL[slot].time}</span>
              </div>
              <ul className="space-y-1.5">
                {meds.map((m) => (
                  <li key={m.medication.id} className="flex items-center gap-2 text-sm">
                    <Pill medication={m.medication} />
                    <span className={cn("truncate", clash.has(m.medication.id) && "text-moderate")}>{m.medication.name}</span>
                  </li>
                ))}
                {habits.map((h) => (
                  <li key={h.food.id} className="truncate pl-6 text-xs text-muted-foreground">
                    {h.food.name}
                  </li>
                ))}
                {!meds.length && !habits.length && <li className="text-xs text-muted-foreground">Nothing scheduled</li>}
              </ul>
            </Card>
          );
        })}
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" /> Timing assistant
          </CardTitle>
          <CardDescription>
            Re-times supplements and over-the-counter products so they don&apos;t block absorption. Prescription times are never changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {schedule.moves.length === 0 && schedule.tips.length === 0 && (
            <p className="text-sm text-muted-foreground">No timing changes needed. Everything that must be spaced apart already is.</p>
          )}
          {schedule.moves.map((m) => (
            <div key={m.medicationId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{m.name}</span>
              <Badge variant="outline">{m.from.map((s) => SLOT_LABEL[s].name).join(" + ")}</Badge>
              <ArrowRight className="size-3.5 text-muted-foreground" />
              <Badge>{m.to.map((s) => SLOT_LABEL[s].name).join(" + ")}</Badge>
              <span className="basis-full text-xs text-muted-foreground sm:basis-auto">{m.reason}</span>
            </div>
          ))}
          {schedule.tips.map((t) => (
            <p key={t.findingId} className="flex gap-2 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-moderate" />
              {t.text}
            </p>
          ))}
          {schedule.moves.length > 0 && (
            <div className="flex items-center gap-3">
              <Button size="sm" disabled={busy} onClick={() => void apply()}>
                Apply suggested schedule
              </Button>
              <span className="text-xs text-muted-foreground">
                Spacing problems: {schedule.clashesBefore} now, {schedule.clashesAfter} after
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {[...byPrescriber.entries()].map(([prescriber, items]) => (
          <Card key={prescriber} className="gap-0 py-2">
            <p className="px-4 pt-1 pb-2 text-xs font-semibold text-muted-foreground">{prescriber}</p>
            <ul className="divide-y">
              {items.map((r) => {
                const advice = report.labelAdvice.filter((a) => a.medicationId === r.medication.id);
                return (
                  <li key={r.medication.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Pill medication={r.medication} size={22} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {medLabel(r.medication)}
                        {r.medication.source === "drugbank" && <span className="ml-2 rounded-full border px-1.5 text-[10px] text-muted-foreground">DrugBank</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[r.dose, r.purpose && `for ${r.purpose.toLowerCase()}`].filter(Boolean).join(", ")}
                        {advice.length > 0 && <span className="text-primary"> · {advice.map((a) => a.text).join(" ")}</span>}
                      </p>
                    </div>
                    <div className="hidden gap-1 sm:flex">
                      {r.slots.map((s) => (
                        <Badge key={s} variant={moving.has(r.medication.id) ? "outline" : "secondary"} className="font-normal">
                          {SLOT_LABEL[s].name}
                        </Badge>
                      ))}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Options for ${r.medication.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => app.openMedicineDialog(r)}>
                          <Pencil /> Edit dose or timing
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => void remove(r)}>
                          <Trash2 /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

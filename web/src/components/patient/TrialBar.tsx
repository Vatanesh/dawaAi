"use client";

import { Loader2, Plus, X } from "lucide-react";
import { motion } from "motion/react";
import { useApp } from "@/components/app/app-context";
import { Pill } from "@/components/common/Pill";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SLOT_LABEL } from "@/lib/client/ui";
import { medLabel } from "@/lib/safety/engine";
import { SLOTS, type SafetyResponse, type Slot } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The medicine being checked before its first dose. Results flow into every tab below it. */
export function TrialBar({ data, name, validating }: { data: SafetyResponse; name: string; validating: boolean }) {
  const app = useApp();
  const trial = app.trial!;
  // While a new check loads, SWR still holds the previous result; don't show its numbers.
  const c = data.report.candidate;
  const fresh = !!c && (c.id === trial.medication.id || c.name === trial.medication.name);
  const med = fresh ? c : trial.medication;
  const mine = fresh ? data.report.findings.filter((f) => f.involvesCandidate) : [];
  const count = (s: "major" | "moderate" | "minor") => mine.filter((f) => f.severity === s).length;
  const ready = fresh && !validating;
  const tone = count("major") ? "text-major" : count("moderate") ? "text-moderate" : "text-clear";

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label="Medicine being checked"
      className="trial-glow flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-card p-3 pl-4"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Pill medication={med} size={26} dashed />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Checking for {name}, not added</p>
          <p className="truncate font-semibold">{medLabel(med)}</p>
        </div>
        <div className={cn("ml-2 hidden items-center gap-1.5 text-sm font-semibold sm:flex", tone)}>
          {!ready ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : mine.length === 0 ? (
            "No known conflicts"
          ) : (
            [count("major") && `${count("major")} serious`, count("moderate") && `${count("moderate")} moderate`, count("minor") && `${count("minor")} minor`]
              .filter(Boolean)
              .join(" · ")
          )}
        </div>
      </div>

      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        value={trial.slots}
        onValueChange={(v) => app.setTrial({ ...trial, slots: SLOTS.filter((s) => v.includes(s)) as Slot[] })}
        aria-label="When it would be taken"
      >
        {SLOTS.map((s) => (
          <ToggleGroupItem key={s} value={s} className="px-2.5 text-xs" title={`Taken at ${SLOT_LABEL[s].time}`}>
            {SLOT_LABEL[s].name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          disabled={!ready}
          onClick={() =>
            app.openMedicineDialog(
              { medication: med, dose: med.ingredients.map((i) => i.strength).filter(Boolean).join(" + "), slots: trial.slots, prescriber: "" },
              true,
            )
          }
        >
          <Plus /> Add to list
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Stop checking" onClick={() => app.setTrial(null)}>
          <X />
        </Button>
      </div>
    </motion.section>
  );
}

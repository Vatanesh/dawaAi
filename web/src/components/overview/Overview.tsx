"use client";

import { AlertTriangle, Clock, Pill as PillIcon, UserPlus, Users } from "lucide-react";
import { motion } from "motion/react";
import { EmptyState, NumberTicker, PatientAvatar, SeverityDot, VerdictBadge } from "@/components/common/bits";
import { useApp } from "@/components/app/app-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOverview } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export function Overview() {
  const app = useApp();
  const { data: people, error } = useOverview();

  const totals = people && {
    people: people.length,
    attention: people.filter((p) => p.verdict === "danger").length,
    serious: people.reduce((s, p) => s + p.counts.major, 0),
    timing: people.reduce((s, p) => s + p.timingClashes, 0),
    meds: people.reduce((s, p) => s + p.medicationCount, 0),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Care overview</h1>
          <p className="text-sm text-muted-foreground">Everyone you look after, most urgent first.</p>
        </div>
        <Button onClick={() => app.openPatientDialog()}>
          <UserPlus /> Add a person
        </Button>
      </div>

      {error && <p className="rounded-lg bg-major-wash p-3 text-sm text-major">The graph couldn&apos;t be read: {error.message}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="stats">
        <Stat icon={<Users />} label="People" value={totals?.people} hint={totals && `${totals.meds} medicines tracked`} />
        <Stat icon={<AlertTriangle />} label="Need attention" value={totals?.attention} tone="major" hint="Have a serious issue" />
        <Stat icon={<PillIcon />} label="Serious issues" value={totals?.serious} tone="major" hint="Across all regimens" />
        <Stat icon={<Clock />} label="Timing issues" value={totals?.timing} tone="moderate" hint="Doses to re-space" />
      </div>

      {people && people.length === 0 && (
        <EmptyState icon={<Users className="size-6" />} title="No one added yet">
          Add the first person you care for. You can then check every medicine, supplement and food habit against each other.
          <div className="mt-4">
            <Button onClick={() => app.openPatientDialog()}>
              <UserPlus /> Add a person
            </Button>
          </div>
        </EmptyState>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {!people && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        {people?.map((p, i) => (
          <motion.button
            key={p.id}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3 }}
            onClick={() => app.openPatient(p.id)}
            data-tour={i === 0 ? "patient-card" : undefined}
            className="group rounded-xl text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Card className="h-full gap-0 p-4 transition-all group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:ring-ring/30">
              <div className="flex items-start gap-3">
                <PatientAvatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[p.relation, p.age && `${p.age} y`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <VerdictBadge verdict={p.verdict} />
              </div>

              <dl className="mt-4 grid grid-cols-3 divide-x rounded-lg bg-muted/60 py-2 text-center">
                <Mini label="Medicines" value={p.medicationCount} />
                <Mini label="Doctors" value={p.prescribers} />
                <Mini label="Alerts" value={p.counts.major + p.counts.moderate} tone={p.counts.major ? "text-major" : p.counts.moderate ? "text-moderate" : undefined} />
              </dl>

              <p className="mt-3 flex min-h-5 items-center gap-2 text-sm">
                {p.top ? (
                  <>
                    <SeverityDot severity={p.top.severity} />
                    <span className="truncate text-muted-foreground">{p.top.title}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No interactions found</span>
                )}
              </p>
            </Card>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value?: number; hint?: string; tone?: "major" | "moderate" }) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <div className={cn("text-3xl font-bold tracking-tight", tone === "major" && value ? "text-major" : tone === "moderate" && value ? "text-moderate" : "")}>
        {value === undefined ? <Skeleton className="h-9 w-12" /> : <NumberTicker value={value} />}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dd className={cn("text-base font-bold tabular-nums", tone)}>{value}</dd>
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
    </div>
  );
}

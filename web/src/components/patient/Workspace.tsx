"use client";

import { FileText, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AnimatedTabs, PatientAvatar } from "@/components/common/bits";
import { useApp, type Tab } from "@/components/app/app-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { refreshPatient, send, useSafety } from "@/lib/client/api";
import { registerRegimenColours } from "@/lib/client/ui";
import { cn } from "@/lib/utils";
import { ActivityTab } from "./ActivityTab";
import { GraphTab } from "./GraphTabLoader";
import { InteractionsTab } from "./InteractionsTab";
import { NotesTab } from "./NotesTab";
import { OverviewTab } from "./OverviewTab";
import { ScheduleTab } from "./ScheduleTab";
import { TrialBar } from "./TrialBar";

export function Workspace({ patientId }: { patientId: string }) {
  const app = useApp();
  const { data, error, isLoading, isValidating } = useSafety(patientId, app.trial);

  if (error)
    return (
      <div className="rounded-xl bg-major-wash p-4 text-sm text-major">
        This person couldn&apos;t be loaded: {error.message}
        <Button variant="outline" size="sm" className="ml-3" onClick={() => app.openPatient(null)}>
          Back to overview
        </Button>
      </div>
    );
  if (!data || isLoading) return <WorkspaceSkeleton />;

  const { context, report, schedule } = data;
  const p = context.patient;
  registerRegimenColours([...context.regimen.map((r) => r.medication.id), ...(report.candidate ? [report.candidate.id] : [])]);
  const name = p.relation || p.name.split(" ")[0];
  const prescribers = new Set(context.regimen.map((r) => r.prescriber).filter((x) => x?.startsWith("Dr"))).size;
  const important = report.findings.filter((f) => f.severity !== "minor" && (!report.candidate || f.involvesCandidate)).length;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "interactions", label: "Interactions", count: important },
    { id: "schedule", label: "Schedule", count: schedule.moves.length + schedule.tips.length },
    { id: "graph", label: "Graph" },
    { id: "notes", label: "Care notes" },
    { id: "activity", label: "Activity" },
  ];

  const remove = async () => {
    if (!confirm(`Remove ${p.name} and their medicine list? This can't be undone.`)) return;
    await send(`/api/patients/${p.id}`, undefined, "DELETE");
    toast.success(`${p.name} removed`);
    app.openPatient(null);
    void refreshPatient();
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <PatientAvatar name={p.name} verdict={report.verdict} size="lg" />
        <div className="min-w-0 flex-1 basis-[calc(100%-4.5rem)] sm:basis-auto">
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{p.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[p.relation, `${p.age} years`, `${context.regimen.length} medicines`, prescribers && `${prescribers} doctors`].filter(Boolean).join(" · ")}
          </p>
          {p.conditions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {p.conditions.slice(0, 4).map((c) => (
                <Badge key={c.id} variant="secondary" className="font-normal" title={c.icd10 ? `ICD-10 ${c.icd10}` : undefined}>
                  {c.name}
                </Badge>
              ))}
              {p.conditions.length > 4 && <Badge variant="outline" className="font-normal">+{p.conditions.length - 4}</Badge>}
            </div>
          )}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button className="flex-1 sm:flex-none" data-tour="check" onClick={() => app.openCommand("check")}>
            <Search /> Check a medicine
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => app.openPatientDialog(p.id)}>
                <Pencil /> Edit profile
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => window.open(`/report?p=${p.id}`, "_blank")}>
                <FileText /> Doctor report
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <Trash2 /> Remove person
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {app.trial && <TrialBar data={data} name={name} validating={isValidating} />}

      <div data-tour="tabs">
        <AnimatedTabs tabs={tabs} value={app.tab} onChange={app.setTab} />
      </div>

      <div className={cn("transition-opacity", isValidating && app.trial && "opacity-70")}>
        {app.tab === "overview" && <OverviewTab data={data} />}
        {app.tab === "interactions" && <InteractionsTab report={report} />}
        {app.tab === "schedule" && <ScheduleTab data={data} />}
        {app.tab === "graph" && <GraphTab graph={data.graph} />}
        {app.tab === "notes" && <NotesTab patientId={p.id} name={name} />}
        {app.tab === "activity" && <ActivityTab patientId={p.id} />}
      </div>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <Skeleton className="h-10 w-full max-w-lg rounded-xl" />
      <div className="grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-52 rounded-xl lg:col-span-2" />
      </div>
    </div>
  );
}

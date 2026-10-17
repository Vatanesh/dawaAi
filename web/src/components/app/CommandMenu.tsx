"use client";

import { Compass, FileText, Info, Pill as PillIcon, Sparkles, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PatientAvatar } from "@/components/common/bits";
import { Pill } from "@/components/common/Pill";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useOverview, useSafety } from "@/lib/client/api";
import { medLabel } from "@/lib/safety/engine";
import type { Medication } from "@/lib/types";
import { useApp } from "./app-context";

export function CommandMenu() {
  const app = useApp();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(false);
  const { data: people } = useOverview();
  const { data: safety } = useSafety(app.patientId);
  const taken = new Set(safety?.context.regimen.map((r) => r.medication.id));
  const person = safety?.context.patient;
  const name = person?.relation || person?.name.split(" ")[0];

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/medications?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then(setMeds)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 140);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const close = () => {
    app.closeCommand();
    setQuery("");
  };
  const q = query.trim().toLowerCase();
  const shownMeds = q.length >= 2 ? meds : [];
  const shownPeople = (people ?? []).filter((p) => !q || `${p.name} ${p.relation ?? ""}`.toLowerCase().includes(q)).slice(0, 5);

  return (
    <CommandDialog
      open={app.command.open}
      onOpenChange={(o) => (o ? app.openCommand(app.command.mode) : close())}
      title="Search"
      description="Search medicines, people and actions"
      className="sm:max-w-xl"
    >
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={person ? `Check a medicine for ${name}, or search…` : "Search medicines or people…"}
        />
        <CommandList className="max-h-[min(420px,60vh)]">
          <CommandEmpty>{loading ? "Searching the graph…" : q.length < 2 ? "Type at least two letters." : "Nothing found."}</CommandEmpty>

          {shownMeds.length > 0 && (
            <CommandGroup heading={person ? `Check before ${name}'s first dose` : "Medicines"}>
              {shownMeds.map((m) => (
                <CommandItem
                  key={m.id}
                  value={m.id}
                  disabled={!person}
                  onSelect={() => {
                    app.setTrial({ medication: m, slots: [] });
                    if (app.tab !== "overview" && app.tab !== "interactions" && app.tab !== "schedule") app.setTab("overview");
                    close();
                  }}
                >
                  <Pill medication={m} />
                  <span className="min-w-0 flex-1 truncate">
                    {medLabel(m)}
                    <span className="ml-2 text-xs text-muted-foreground">{m.description}</span>
                  </span>
                  {taken.has(m.id) ? (
                    <span className="text-xs text-muted-foreground">Taking</span>
                  ) : m.source === "drugbank" ? (
                    <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">DrugBank</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {shownPeople.length > 0 && (
            <CommandGroup heading="People">
              {shownPeople.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`person-${p.id}`}
                  onSelect={() => {
                    app.openPatient(p.id);
                    close();
                  }}
                >
                  <PatientAvatar name={p.name} verdict={p.verdict} size="sm" />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.medicationCount} meds</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!q && (
            <CommandGroup heading="Actions">
              <CommandItem
                value="ask"
                onSelect={() => {
                  close();
                  app.openAsk();
                }}
              >
                <Sparkles /> Ask a question
              </CommandItem>
              <CommandItem
                value="why"
                onSelect={() => {
                  close();
                  router.push("/");
                }}
              >
                <Info /> Why DawaAI: the graph, the data, the business
              </CommandItem>
              <CommandItem
                value="tour"
                onSelect={() => {
                  close();
                  app.startTour();
                }}
              >
                <Compass /> Take the tour
              </CommandItem>
              <CommandItem
                value="add-person"
                onSelect={() => {
                  close();
                  app.openPatientDialog();
                }}
              >
                <UserPlus /> Add a person
              </CommandItem>
              {person && (
                <CommandItem
                  value="report"
                  onSelect={() => {
                    close();
                    window.open(`/report?p=${person.id}`, "_blank");
                  }}
                >
                  <FileText /> Print doctor report for {name}
                </CommandItem>
              )}
              {person && (
                <CommandItem
                  value="check-hint"
                  onSelect={() => setQuery("")}
                  disabled
                >
                  <PillIcon /> Type a medicine name to check it for {name}
                </CommandItem>
              )}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

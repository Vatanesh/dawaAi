"use client";

import { Check, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { refreshPatient, send, useCatalog, useSafety } from "@/lib/client/api";
import { SLOT_LABEL } from "@/lib/client/ui";
import { SLOTS, type PatientContext, type PatientInput, type Slot } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PatientDialog() {
  const app = useApp();
  const { open, editId } = app.patientDialog;
  const { data: existing } = useSafety(open ? editId : undefined);
  const ready = !editId || existing;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && app.closePatientDialog()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open && ready && <PatientForm key={editId ?? "new"} existing={editId ? existing?.context : undefined} />}
        {open && !ready && <Loader2 className="mx-auto my-10 animate-spin text-muted-foreground" />}
      </DialogContent>
    </Dialog>
  );
}

type Habit = PatientInput["habits"][number];

function PatientForm({ existing }: { existing?: PatientContext }) {
  const app = useApp();
  const { data: catalog } = useCatalog();
  const p = existing?.patient;
  const [name, setName] = useState(p?.name ?? "");
  const [age, setAge] = useState(p?.age ? String(p.age) : "");
  const [sex, setSex] = useState<string>(p?.sex ?? "");
  const [relation, setRelation] = useState(p?.relation ?? "");
  const [conditions, setConditions] = useState<{ id?: string; name: string }[]>(p?.conditions.map((c) => ({ id: c.id, name: c.name })) ?? []);
  const [custom, setCustom] = useState("");
  const [habits, setHabits] = useState<Habit[]>(existing?.habits.map((h) => ({ foodId: h.food.id, frequency: h.frequency, slot: h.slot })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCondition = (id: string) => conditions.some((c) => c.id === id);
  const toggleCondition = (c: { id: string; name: string }) =>
    setConditions((cs) => (hasCondition(c.id) ? cs.filter((x) => x.id !== c.id) : [...cs, c]));
  const habit = (foodId: string) => habits.find((h) => h.foodId === foodId);
  const toggleHabit = (foodId: string) =>
    setHabits((hs) => (habit(foodId) ? hs.filter((h) => h.foodId !== foodId) : [...hs, { foodId, frequency: "Daily", slot: "morning" }]));
  const patchHabit = (foodId: string, patch: Partial<Habit>) => setHabits((hs) => hs.map((h) => (h.foodId === foodId ? { ...h, ...patch } : h)));

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { name, age: Number(age), sex: sex || undefined, relation: relation || undefined, conditions, habits };
    try {
      if (p) {
        await send(`/api/patients/${p.id}`, body, "PATCH");
        toast.success("Profile updated");
        await refreshPatient(p.id);
      } else {
        const { id } = await send<{ id: string }>("/api/patients", body);
        toast.success(`${name} added`, { description: "Next: check their medicines one by one." });
        await refreshPatient();
        app.openPatient(id);
      }
      app.closePatientDialog();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{p ? `Edit ${p.name}` : "Add a person"}</DialogTitle>
        <DialogDescription>Conditions and daily habits are checked against every medicine.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="pname">Full name</Label>
          <Input id="pname" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ramesh Iyer" autoFocus />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="page">Age</Label>
          <Input id="page" required inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} placeholder="78" />
        </div>
        <div className="grid gap-1.5">
          <Label>Sex</Label>
          <Select value={sex} onValueChange={setSex}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="prel">How you refer to them</Label>
          <Input id="prel" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Dad, Mum, Room 12…" />
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Health conditions</legend>
        <div className="flex flex-wrap gap-1.5">
          {catalog?.conditions.map((c) => (
            <Chip key={c.id} on={hasCondition(c.id)} onClick={() => toggleCondition(c)} title={c.icd10 ? `ICD-10 ${c.icd10}` : undefined}>
              {c.name}
            </Chip>
          ))}
          {conditions
            .filter((c) => !catalog?.conditions.some((x) => x.id === c.id))
            .map((c) => (
              <Chip key={c.name} on onClick={() => setConditions((cs) => cs.filter((x) => x !== c))}>
                {c.name}
              </Chip>
            ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Another condition"
            className="h-8"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (custom.trim().length > 1) setConditions((cs) => [...cs, { name: custom.trim() }]);
                setCustom("");
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (custom.trim().length > 1) setConditions((cs) => [...cs, { name: custom.trim() }]);
              setCustom("");
            }}
          >
            <Plus /> Add
          </Button>
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Food and drink habits</legend>
        <div className="flex flex-wrap gap-1.5">
          {catalog?.foods.map((f) => (
            <Chip key={f.id} on={!!habit(f.id)} onClick={() => toggleHabit(f.id)}>
              {f.name}
            </Chip>
          ))}
        </div>
        {habits.map((h) => (
          <div key={h.foodId} className="grid grid-cols-[1fr_1.2fr_1fr] items-center gap-2 text-sm">
            <span className="truncate text-muted-foreground">{catalog?.foods.find((f) => f.id === h.foodId)?.name}</span>
            <Input className="h-8" value={h.frequency} onChange={(e) => patchHabit(h.foodId, { frequency: e.target.value })} aria-label="How often" />
            <Select value={h.slot} onValueChange={(v) => patchHabit(h.foodId, { slot: v as Slot })}>
              <SelectTrigger size="sm" className="w-full" aria-label="When">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLOTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SLOT_LABEL[s].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={app.closePatientDialog}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || name.trim().length < 2 || !age}>
          {busy && <Loader2 className="animate-spin" />}
          {p ? "Save changes" : "Add person"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Chip({ on, children, onClick, title }: { on: boolean; children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "hover:border-ring/50 hover:bg-muted",
      )}
    >
      {on && <Check className="size-3" />}
      {children}
    </button>
  );
}

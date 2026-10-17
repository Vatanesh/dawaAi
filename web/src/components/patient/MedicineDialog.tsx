"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";
import { Pill } from "@/components/common/Pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { refreshPatient, send } from "@/lib/client/api";
import { SLOT_LABEL } from "@/lib/client/ui";
import { medLabel } from "@/lib/safety/engine";
import { SLOTS, type RegimenItem, type Slot } from "@/lib/types";

export function MedicineDialog() {
  const app = useApp();
  const { open, item, isNew } = app.medicineDialog;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && app.closeMedicineDialog()}>
      <DialogContent className="sm:max-w-md">
        {item && app.patientId && (
          <MedicineForm key={item.medication.id} item={item} isNew={!!isNew} patientId={app.patientId} onDone={app.closeMedicineDialog} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MedicineForm({ item, isNew, patientId, onDone }: { item: RegimenItem; isNew: boolean; patientId: string; onDone: () => void }) {
  const app = useApp();
  const [dose, setDose] = useState(item.dose ?? "");
  const [slots, setSlots] = useState<Slot[]>(item.slots);
  const [prescriber, setPrescriber] = useState(item.prescriber && item.prescriber !== "Being considered" ? item.prescriber : "");
  const [purpose, setPurpose] = useState(item.purpose ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/patients/${patientId}/regimen`, {
        medicationId: item.medication.id,
        dose,
        slots,
        prescriber: prescriber || undefined,
        purpose: purpose || undefined,
      });
      toast.success(isNew ? `${item.medication.name} added` : `${item.medication.name} updated`);
      if (isNew) app.setTrial(null);
      onDone();
      await refreshPatient(patientId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Pill medication={item.medication} size={20} />
          {isNew ? "Add" : "Edit"} {medLabel(item.medication)}
        </DialogTitle>
        <DialogDescription>{isNew ? "It will be checked against everything else on the list." : "Changes are re-checked straight away."}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="dose">Dose</Label>
        <Input id="dose" required value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 5 mg once daily" />
      </div>

      <div className="grid gap-1.5">
        <Label>When is it taken?</Label>
        <ToggleGroup type="multiple" variant="outline" value={slots} onValueChange={(v) => setSlots(SLOTS.filter((s) => v.includes(s)))} className="w-full">
          {SLOTS.map((s) => (
            <ToggleGroupItem key={s} value={s} className="flex-1 flex-col gap-0 py-5 text-xs">
              {SLOT_LABEL[s].name}
              <span className="text-[10px] text-muted-foreground">{SLOT_LABEL[s].time}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="prescriber">Prescribed by</Label>
          <Input id="prescriber" value={prescriber} onChange={(e) => setPrescriber(e.target.value)} placeholder="Dr. Shah, cardiologist" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="purpose">For</Label>
          <Input id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Blood pressure" />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !slots.length || !dose.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          {isNew ? "Add medicine" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

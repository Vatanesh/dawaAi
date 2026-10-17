"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Trial } from "@/lib/client/api";
import type { Finding, RegimenItem } from "@/lib/types";

export type Tab = "overview" | "interactions" | "schedule" | "graph" | "notes" | "activity";

interface AppState {
  patientId?: string;
  tab: Tab;
  openPatient: (id: string | null, tab?: Tab) => void;
  setTab: (tab: Tab) => void;

  trial: Trial | null;
  setTrial: (t: Trial | null) => void;

  command: { open: boolean; mode: "check" | "all" };
  openCommand: (mode?: "check" | "all") => void;
  closeCommand: () => void;

  ask: { open: boolean; prompt?: string };
  openAsk: (prompt?: string) => void;
  closeAsk: () => void;

  finding: Finding | null;
  openFinding: (f: Finding | null) => void;

  patientDialog: { open: boolean; editId?: string };
  openPatientDialog: (editId?: string) => void;
  closePatientDialog: () => void;

  medicineDialog: { open: boolean; item?: RegimenItem; isNew?: boolean };
  openMedicineDialog: (item: RegimenItem, isNew?: boolean) => void;
  closeMedicineDialog: () => void;

  tourOpen: boolean;
  startTour: () => void;
  endTour: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

const TABS: Tab[] = ["overview", "interactions", "schedule", "graph", "notes", "activity"];

/** URL is the source of truth for where you are (?p=<patient>&tab=<tab>), so views are deep-linkable. */
export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const patientId = params.get("p") ?? undefined;
  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "overview";

  const [trial, setTrialState] = useState<Trial | null>(null);
  const [command, setCommand] = useState<AppState["command"]>({ open: false, mode: "all" });
  // /?p=<id>&ask=<question> (used by the About page) opens the assistant with that question.
  // The Home page mounts fresh on that navigation, so the initial state can read the param.
  const [ask, setAsk] = useState<AppState["ask"]>(() => {
    const q = params.get("ask");
    return q ? { open: true, prompt: q } : { open: false };
  });
  const [finding, openFinding] = useState<Finding | null>(null);
  const [patientDialog, setPatientDialog] = useState<AppState["patientDialog"]>({ open: false });
  const [medicineDialog, setMedicineDialog] = useState<AppState["medicineDialog"]>({ open: false });
  const [tourOpen, setTourOpen] = useState(false);

  // Take the question out of the address bar once it has been picked up.
  const askParam = params.get("ask");
  useEffect(() => {
    if (!askParam) return;
    const next = new URLSearchParams(params.toString());
    next.delete("ask");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askParam]);

  const go = useCallback(
    (next: { p?: string | null; tab?: Tab }) => {
      const q = new URLSearchParams(params.toString());
      if (next.p !== undefined) {
        if (next.p) q.set("p", next.p);
        else q.delete("p");
      }
      if (next.tab) {
        if (next.tab === "overview") q.delete("tab");
        else q.set("tab", next.tab);
      }
      const s = q.toString();
      router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const value = useMemo<AppState>(
    () => ({
      patientId,
      tab,
      openPatient: (id, t) => {
        if (id !== patientId) setTrialState(null);
        go({ p: id, tab: t ?? "overview" });
      },
      setTab: (t) => go({ tab: t }),
      trial,
      setTrial: setTrialState,
      command,
      openCommand: (mode = "all") => setCommand({ open: true, mode }),
      closeCommand: () => setCommand((c) => ({ ...c, open: false })),
      ask,
      openAsk: (prompt) => setAsk({ open: true, prompt }),
      closeAsk: () => setAsk({ open: false }),
      finding,
      openFinding,
      patientDialog,
      openPatientDialog: (editId) => setPatientDialog({ open: true, editId }),
      closePatientDialog: () => setPatientDialog({ open: false }),
      medicineDialog,
      openMedicineDialog: (item, isNew) => setMedicineDialog({ open: true, item, isNew }),
      closeMedicineDialog: () => setMedicineDialog({ open: false }),
      tourOpen,
      startTour: () => {
        // A tour starts from a clean slate: no sheets or dialogs covering what it points at.
        setCommand((c) => ({ ...c, open: false }));
        setAsk({ open: false });
        openFinding(null);
        setTourOpen(true);
      },
      endTour: () => setTourOpen(false),
    }),
    [patientId, tab, trial, command, ask, finding, patientDialog, medicineDialog, tourOpen, go],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

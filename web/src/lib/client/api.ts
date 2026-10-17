"use client";

import useSWR, { mutate as globalMutate } from "swr";
import type { CareNote, ChatMessage, Trace } from "../memory/client";
import type { Medication, PatientOverview, PatientSummary, SafetyResponse, Slot } from "../types";

export const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
  return res.json();
};

export interface Status {
  graph: "neo4j" | "demo";
  memory: "neo4j-agent-memory" | "neo4j-read" | "local";
  ai: "graph" | "claude" | "router";
  model: string | null;
  aiIssue?: string | null;
}

export interface Catalog {
  conditions: { id: string; name: string; icd10?: string }[];
  foods: { id: string; name: string }[];
}

export interface Trial {
  medication: Medication;
  slots: Slot[];
}

export const useStatus = () => useSWR<Status>("/api/status", fetcher);
export const usePatients = () => useSWR<PatientSummary[]>("/api/patients", fetcher);
export const useOverview = () => useSWR<PatientOverview[]>("/api/overview", fetcher, { keepPreviousData: true });
export const useCatalog = () => useSWR<Catalog>("/api/catalog", fetcher, { revalidateOnFocus: false });

export function useSafety(patientId: string | undefined, trial?: Trial | null) {
  const qs = trial ? `?candidate=${encodeURIComponent(trial.medication.id)}&slots=${trial.slots.join(",")}` : "";
  return useSWR<SafetyResponse>(patientId ? `/api/patients/${patientId}/safety${qs}` : null, fetcher, { keepPreviousData: true });
}

export const useNotes = (patientId?: string) => useSWR<CareNote[]>(patientId ? `/api/patients/${patientId}/notes` : null, fetcher);
export const useTraces = (patientId?: string) => useSWR<Trace[]>(patientId ? `/api/patients/${patientId}/traces` : null, fetcher);
export const useChatHistory = (patientId?: string) =>
  useSWR<ChatMessage[]>(patientId ? `/api/patients/${patientId}/chat` : null, fetcher, { revalidateOnFocus: false });

export async function send<T = unknown>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Refresh everything that depends on a patient's graph after a change. */
export function refreshPatient(patientId?: string) {
  return globalMutate(
    (key) =>
      typeof key === "string" &&
      (key === "/api/overview" || key === "/api/patients" || (!!patientId && key.startsWith(`/api/patients/${patientId}`))),
  );
}

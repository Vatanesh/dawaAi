import type { FindingKind, MedicationKind, SafetyReport, Severity, Slot } from "../types";

// Every medicine gets a stable pill colour + shape so caregivers recognise "the yellow one"
// in the list, the day plan and the graph alike.
const PILL_COLOURS = ["#f2c14e", "#ec8f6a", "#7fc0e6", "#b7a3e6", "#8fd3a8", "#f4a9bf", "#d8cdb6", "#6fb8a5", "#e7e17a", "#a9c4f0", "#f0b48a", "#9fd6d2"];

export function pillColour(medicationId: string): string {
  const fixed = assigned.get(medicationId);
  if (fixed) return fixed;
  let h = 2166136261;
  for (const ch of medicationId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return PILL_COLOURS[h % PILL_COLOURS.length];
}

export type PillShape = "round" | "oval" | "capsule";
export const pillShape = (kind: MedicationKind): PillShape => (kind === "supplement" ? "capsule" : kind === "otc" ? "oval" : "round");

export const SEVERITY: Record<Severity, { label: string; text: string; bg: string; dot: string; ring: string }> = {
  major: { label: "Serious", text: "text-major", bg: "bg-major-wash", dot: "bg-major", ring: "ring-major/30" },
  moderate: { label: "Moderate", text: "text-moderate", bg: "bg-moderate-wash", dot: "bg-moderate", ring: "ring-moderate/30" },
  minor: { label: "Minor", text: "text-minor", bg: "bg-minor-wash", dot: "bg-minor", ring: "ring-minor/30" },
};

export const VERDICT: Record<SafetyReport["verdict"], { label: string; text: string; bg: string; dot: string }> = {
  danger: { label: "Needs attention", text: "text-major", bg: "bg-major-wash", dot: "bg-major" },
  caution: { label: "Watch", text: "text-moderate", bg: "bg-moderate-wash", dot: "bg-moderate" },
  clear: { label: "Stable", text: "text-clear", bg: "bg-clear-wash", dot: "bg-clear" },
};

export const KIND_LABEL: Record<FindingKind, string> = {
  "drug-drug": "Drug interaction",
  duplicate: "Duplicate",
  food: "Food & drink",
  condition: "Condition",
  nutrient: "Nutrient",
  timing: "Timing",
};

export const SLOT_LABEL: Record<Slot, { name: string; short: string; time: string }> = {
  morning: { name: "Morning", short: "AM", time: "8:00" },
  midday: { name: "Midday", short: "Noon", time: "13:00" },
  evening: { name: "Evening", short: "PM", time: "18:00" },
  bedtime: { name: "Bedtime", short: "Bed", time: "22:00" },
};

/**
 * 0-100, higher is safer. One serious issue outweighs many minor ones: serious -18 each,
 * moderate -5 each (capped at -40), minor -0.5 each (capped at -8).
 */
export function safetyScore(counts: Record<Severity, number>) {
  const penalty = counts.major * 18 + Math.min(40, counts.moderate * 5) + Math.min(8, counts.minor * 0.5);
  return Math.max(0, Math.round(100 - penalty));
}

// Distinct pill colours within the person on screen: the workspace registers its regimen order,
// so two medicines in the same pill box never share a colour (hash fallback elsewhere).
const assigned = new Map<string, string>();
export function registerRegimenColours(ids: string[]) {
  assigned.clear();
  ids.forEach((id, i) => assigned.set(id, PILL_COLOURS[i % PILL_COLOURS.length]));
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

export const relativeTime = (iso: string) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

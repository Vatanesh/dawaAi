// Dosage-timing optimiser. Finds the pairs that must be spaced apart (absorption clashes such as
// levothyroxine + calcium) and proposes a re-timed day that keeps them apart.
//
// Safety rules: only supplements and over-the-counter products are moved; prescription timing is the
// prescriber's call, so clashes between two prescriptions become advice instead. Each product keeps its
// number of daily doses. Food-timing clashes (coffee too close to a pill) become tips, never moves.

import type { Finding, KnowledgeSlice, RegimenItem, SchedulePlan, Slot } from "../types";
import { SLOTS } from "../types";

const HOUR: Record<Slot, number> = { morning: 8, midday: 13, evening: 18, bedtime: 22 };
const FLEX: Record<RegimenItem["medication"]["kind"], number> = { supplement: 0, otc: 1, prescription: 2 };

interface Constraint {
  a: string; // medication ids
  b: string;
  hours: number;
  reason: string;
}

function gap(a: Slot[], b: Slot[]) {
  let g = Infinity;
  for (const x of a)
    for (const y of b) {
      const raw = Math.abs(HOUR[x] - HOUR[y]);
      g = Math.min(g, raw, 24 - raw);
    }
  return g;
}

function combinations(k: number): Slot[][] {
  const out: Slot[][] = [];
  const walk = (start: number, acc: Slot[]) => {
    if (acc.length === k) return void out.push([...acc]);
    for (let i = start; i < SLOTS.length; i++) walk(i + 1, [...acc, SLOTS[i]]);
  };
  walk(0, []);
  return out;
}

export function planSchedule(items: RegimenItem[], knowledge: KnowledgeSlice, findings: Finding[]): SchedulePlan {
  const scheduled = items.filter((i) => i.slots.length);
  const holders = new Map<string, RegimenItem[]>();
  for (const it of scheduled) for (const ing of it.medication.ingredients) holders.set(ing.id, [...(holders.get(ing.id) ?? []), it]);

  const constraints: Constraint[] = [];
  for (const e of knowledge.interactions) {
    if (!e.separateHours) continue;
    for (const x of holders.get(e.a.id) ?? [])
      for (const y of holders.get(e.b.id) ?? [])
        if (x.medication.id !== y.medication.id)
          constraints.push({ a: x.medication.id, b: y.medication.id, hours: e.separateHours, reason: e.recommendation });
  }

  const assign = new Map(scheduled.map((i) => [i.medication.id, [...i.slots]]));
  const byId = new Map(scheduled.map((i) => [i.medication.id, i]));
  const clashes = (m: Map<string, Slot[]>) => constraints.filter((c) => gap(m.get(c.a)!, m.get(c.b)!) < c.hours);
  const clashesBefore = clashes(assign).length;

  // Greedy repair: move the most flexible product in each clash to the slot set that clears the most
  // clashes with the fewest changes. A handful of products, so exhaustive per-product search is cheap.
  for (let round = 0; round < 6; round++) {
    const open = clashes(assign);
    if (!open.length) break;
    let improved = false;
    for (const c of open) {
      const [x, y] = [byId.get(c.a)!, byId.get(c.b)!].sort((p, q) => FLEX[p.medication.kind] - FLEX[q.medication.kind]);
      const movable = [x, y].filter((it) => it.medication.kind !== "prescription");
      for (const it of movable) {
        const id = it.medication.id;
        const current = assign.get(id)!;
        let best = { slots: current, score: clashes(assign).length * 10 };
        for (const option of combinations(current.length)) {
          const trial = new Map(assign).set(id, option);
          const changed = option.filter((s) => !it.slots.includes(s)).length;
          const score = clashes(trial).length * 10 + changed;
          if (score < best.score) best = { slots: option, score };
        }
        if (best.slots !== current) {
          assign.set(id, best.slots);
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }

  const remaining = clashes(assign);
  const reasons = new Map<string, string>();
  for (const c of constraints) {
    reasons.set(c.a, reasons.get(c.a) ?? c.reason);
    reasons.set(c.b, reasons.get(c.b) ?? c.reason);
  }
  const moves = scheduled
    .filter((i) => assign.get(i.medication.id)!.join() !== i.slots.join())
    .map((i) => ({
      medicationId: i.medication.id,
      name: i.medication.name,
      from: i.slots,
      to: assign.get(i.medication.id)!,
      reason: reasons.get(i.medication.id) ?? "Keeps it apart from medicines it binds to.",
    }));

  const tips = findings
    .filter((f) => f.kind === "timing" && f.severity !== "minor" && (f.path.some((n) => n.label === "Food") || remaining.some((c) => f.medicationIds.includes(c.a) && f.medicationIds.includes(c.b))))
    .map((f) => ({ findingId: f.id, text: f.recommendation }));

  return { moves, tips, clashesBefore, clashesAfter: remaining.length };
}

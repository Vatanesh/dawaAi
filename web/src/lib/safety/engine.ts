// Turns a patient's subgraph + the knowledge edges touching it into ranked, explainable findings.
// Pure and deterministic: the same graph always yields the same report, with the graph path
// behind every finding so the UI (and the AI assistant) can cite it.

import type {
  Finding,
  GraphView,
  Ingredient,
  KnowledgeSlice,
  Medication,
  PathNode,
  PatientContext,
  RegimenItem,
  SafetyReport,
  Severity,
  Slot,
} from "../types";

const SEVERITY_RANK: Record<Severity, number> = { major: 0, moderate: 1, minor: 2 };
const SLOT_HOUR: Record<Slot, number> = { morning: 8, midday: 13, evening: 18, bedtime: 22 };
const SUPPLEMENT_ATC = ["A11", "A12", "B02", "B03"]; // vitamins, minerals, vitamin K, iron

export function medLabel(m: Pick<Medication, "name" | "brand">): string {
  return m.brand && m.brand !== m.name ? `${m.name} (${m.brand})` : m.name;
}

const node = {
  patient: (c: PatientContext): PathNode => ({ label: "Patient", id: `patient:${c.patient.id}`, name: c.patient.name }),
  med: (m: Medication): PathNode => ({ label: "Medication", id: `med:${m.id}`, name: medLabel(m) }),
  ing: (i: Ingredient): PathNode => ({ label: "ActiveIngredient", id: `ing:${i.id}`, name: i.name }),
  cls: (c: { id: string; name: string }): PathNode => ({ label: "DrugClass", id: `cls:${c.id}`, name: `${c.name} (${c.id})` }),
  food: (f: { id: string; name: string }): PathNode => ({ label: "Food", id: `food:${f.id}`, name: f.name }),
  nutrient: (n: { id: string; name: string }): PathNode => ({ label: "Nutrient", id: `nut:${n.id}`, name: n.name }),
  condition: (c: { id: string; name: string }): PathNode => ({ label: "Condition", id: `cond:${c.id}`, name: c.name }),
};

/** Smallest gap in hours between any dose of one schedule and any dose of the other. */
function minGapHours(a: Slot[], b: Slot[]): number {
  let gap = Infinity;
  for (const x of a)
    for (const y of b) {
      const raw = Math.abs(SLOT_HOUR[x] - SLOT_HOUR[y]);
      gap = Math.min(gap, raw, 24 - raw);
    }
  return gap;
}

/** Product name, plus the specific ingredient when the product has several (e.g. a multivitamin). */
const pairName = (m: Medication, ing: Ingredient) =>
  m.ingredients.length > 1 ? `${medLabel(m)} (${ing.name.toLowerCase()})` : medLabel(m);

const slotList = (slots: Slot[]) => slots.join(" and ");

/** A path node plus the relationship type that links it to the next node. */
const hop = (n: PathNode, rel: string): PathNode => ({ ...n, rel });

export function analyse(
  context: PatientContext,
  knowledge: KnowledgeSlice,
  candidateOrMany?: RegimenItem | RegimenItem[],
): SafetyReport {
  // One or several medicines under consideration (e.g. "started on furosemide and digoxin").
  const candidates = candidateOrMany ? (Array.isArray(candidateOrMany) ? candidateOrMany : [candidateOrMany]) : [];
  const candidate = candidates[0];
  const candidateIds = new Set(candidates.map((c) => c.medication.id));
  const items = [...context.regimen.filter((r) => !candidateIds.has(r.medication.id)), ...candidates];
  const findings = new Map<string, Finding>();

  const add = (f: Omit<Finding, "involvesCandidate">) => {
    if (findings.has(f.id)) return;
    findings.set(f.id, { ...f, involvesCandidate: f.medicationIds.some((id) => candidateIds.has(id)) });
  };

  // ingredient id -> regimen items that contain it
  const holders = new Map<string, RegimenItem[]>();
  for (const item of items)
    for (const ing of item.medication.ingredients) holders.set(ing.id, [...(holders.get(ing.id) ?? []), item]);

  // 1. Drug-drug interactions (explicit + inferred through the ATC ontology), with timing checks.
  const interactingPairs = new Set<string>();
  for (const edge of knowledge.interactions) {
    // Only curated or ontology-inferred edges count as "already explained": a DrugBank
    // boilerplate sentence must not hide the "two drugs of the same class" check below.
    if (edge.source !== "drugbank") interactingPairs.add([edge.a.id, edge.b.id].sort().join("|"));
    for (const ia of holders.get(edge.a.id) ?? [])
      for (const ib of holders.get(edge.b.id) ?? []) {
        if (ia.medication.id === ib.medication.id) continue;
        const [ma, mb] = [ia.medication, ib.medication];
        const medicationIds = [ma.id, mb.id];
        const pairId = [ma.id, mb.id].sort().join("+");
        const start = hop(node.patient(context), candidateIds.has(ma.id) ? "CONSIDERING" : "TAKES");
        const path: PathNode[] = edge.inferredVia
          ? [
              start,
              hop(node.med(ma), "CONTAINS"),
              hop(node.ing(edge.a), "IN_CLASS"),
              hop(node.cls(edge.inferredVia.a), "CLASS_INTERACTS_WITH"),
              hop(node.cls(edge.inferredVia.b), "IN_CLASS"),
              hop(node.ing(edge.b), "CONTAINS"),
              node.med(mb),
            ]
          : [start, hop(node.med(ma), "CONTAINS"), hop(node.ing(edge.a), "INTERACTS_WITH"), hop(node.ing(edge.b), "CONTAINS"), node.med(mb)];
        const via = edge.inferredVia
          ? ` Flagged through the drug-class ontology: ${edge.inferredVia.a.name} × ${edge.inferredVia.b.name}.`
          : "";

        if (edge.separateHours && ia.slots.length && ib.slots.length) {
          const gap = minGapHours(ia.slots, ib.slots);
          const clash = gap < edge.separateHours;
          add({
            id: `timing:${pairId}`,
            kind: "timing",
            severity: clash ? edge.severity : "minor",
            title: clash
              ? `${ma.name} and ${mb.name} are taken too close together`
              : `${ma.name} and ${mb.name} are already spaced apart`,
            detail: clash
              ? `${edge.effect} Right now ${ma.name} is taken in the ${slotList(ia.slots)} and ${mb.name} in the ${slotList(ib.slots)}.`
              : `${edge.effect} The current schedule keeps them at least ${edge.separateHours} hours apart, which is what's needed.`,
            recommendation: clash ? edge.recommendation : "Keep the current timing.",
            medicationIds,
            path,
          });
          continue;
        }
        add({
          id: `drug:${pairId}:${edge.a.id}:${edge.b.id}`,
          kind: "drug-drug",
          severity: edge.severity,
          title: `${pairName(ma, edge.a)} + ${pairName(mb, edge.b)}`,
          detail: `${edge.effect}${edge.mechanism ? ` ${edge.mechanism}` : ""}${via}`,
          recommendation: edge.recommendation,
          medicationIds,
          path,
          source: edge.source,
          evidence: edge.source !== "drugbank" ? edge.drugbank : undefined,
        });
      }
  }

  // 2. Duplicates: same ingredient in two products, or two drugs from the same ATC chemical subgroup.
  for (const [ingId, its] of holders) {
    if (its.length < 2) continue;
    const ing = its[0].medication.ingredients.find((i) => i.id === ingId)!;
    const isSupplement = SUPPLEMENT_ATC.some((p) => ing.atc?.startsWith(p));
    const severity: Severity = ingId === "acetaminophen" ? "major" : isSupplement ? "minor" : "moderate";
    add({
      id: `dup:${ingId}`,
      kind: "duplicate",
      severity,
      title: `${ing.name} is in ${its.length} different products`,
      detail:
        ingId === "acetaminophen"
          ? `${its.map((i) => medLabel(i.medication)).join(" and ")} both contain acetaminophen. Taking both makes it easy to go over the safe daily limit (3 g for older adults), which can damage the liver.`
          : `${its.map((i) => medLabel(i.medication)).join(" and ")} both contain ${ing.name}, so the total dose is higher than either label suggests.`,
      recommendation:
        ingId === "acetaminophen"
          ? "Use only one acetaminophen product at a time and count every dose."
          : "Check with a pharmacist whether both products are needed.",
      medicationIds: its.map((i) => i.medication.id),
      path: its.map((i) => hop(node.med(i.medication), "CONTAINS")).concat(node.ing(ing)),
    });
  }
  const ingList = [...holders.keys()];
  for (let x = 0; x < ingList.length; x++)
    for (let y = x + 1; y < ingList.length; y++) {
      const [i, j] = [ingList[x], ingList[y]];
      const ci = knowledge.classOf[i]?.[0];
      const cj = knowledge.classOf[j]?.[0];
      if (!ci || ci.id !== cj?.id || SUPPLEMENT_ATC.some((p) => ci.id.startsWith(p))) continue;
      if (interactingPairs.has([i, j].sort().join("|"))) continue;
      const mi = holders.get(i)![0].medication;
      const mj = holders.get(j)![0].medication;
      if (mi.id === mj.id) continue;
      const ingI = mi.ingredients.find((x) => x.id === i)!;
      const ingJ = mj.ingredients.find((x) => x.id === j)!;
      const anticoag = knowledge.classOf[i].some((c) => c.id === "B01A");
      add({
        id: `class-dup:${ci.id}:${[mi.id, mj.id].sort().join("+")}`,
        kind: "duplicate",
        severity: anticoag ? "major" : "moderate",
        title: `Two ${(knowledge.classOf[i][1] ?? ci).name.replace(/\s*\(.*\)/, "")} at once`,
        detail: `${medLabel(mi)} and ${medLabel(mj)} belong to the same drug class (ATC ${ci.id}). Taking two usually doubles the effect and side effects, and often happens when different doctors each prescribe one.`,
        recommendation: "Ask the prescribers whether both are intended.",
        medicationIds: [mi.id, mj.id],
        path: [hop(node.med(mi), "CONTAINS"), hop(node.ing(ingI), "IN_CLASS"), hop(node.cls(ci), "IN_CLASS"), hop(node.ing(ingJ), "CONTAINS"), node.med(mj)],
      });
    }

  // 3. Food and drink the patient actually consumes.
  const habitByFood = new Map(context.habits.map((h) => [h.food.id, h]));
  const watchFoods: SafetyReport["watchFoods"] = [];
  for (const edge of knowledge.foodConflicts) {
    const habit = habitByFood.get(edge.food.id);
    if (!habit) {
      watchFoods.push(edge);
      continue;
    }
    for (const item of holders.get(edge.ingredient.id) ?? []) {
      const m = item.medication;
      const path = [hop(node.patient(context), "CONSUMES"), hop(node.food(edge.food), "CONFLICTS_WITH"), hop(node.ing(edge.ingredient), "CONTAINS"), node.med(m)];
      if (edge.separateHours && habit.slot && item.slots.length) {
        const clash = minGapHours([habit.slot], item.slots) < edge.separateHours;
        if (!clash) continue;
        add({
          id: `food-timing:${m.id}:${edge.food.id}`,
          kind: "timing",
          severity: edge.severity,
          title: `${edge.food.name} too close to ${m.name}`,
          detail: `${edge.effect} Habit on record: ${habit.frequency.toLowerCase()}.`,
          recommendation: edge.recommendation,
          medicationIds: [m.id],
          path,
        });
        continue;
      }
      add({
        id: `food:${m.id}:${edge.food.id}`,
        kind: "food",
        severity: edge.severity,
        title: `${medLabel(m)} + ${edge.food.name.toLowerCase()}`,
        detail: `${edge.effect} Habit on record: ${habit.frequency.toLowerCase()}.`,
        recommendation: edge.recommendation,
        medicationIds: [m.id],
        path,
        source: edge.source,
      });
    }
  }

  // 4. Conditions the medicine is risky for.
  for (const edge of knowledge.contraindications)
    for (const item of holders.get(edge.ingredient.id) ?? [])
      add({
        id: `cond:${item.medication.id}:${edge.condition.id}`,
        kind: "condition",
        severity: edge.severity,
        title: `${pairName(item.medication, edge.ingredient)} with ${edge.condition.name.toLowerCase()}`,
        detail: item.medication.ingredients.length > 1 ? `${edge.ingredient.name}: ${edge.effect}` : edge.effect,
        recommendation: edge.recommendation,
        medicationIds: [item.medication.id],
        path: [
          hop(node.patient(context), "HAS_CONDITION"),
          hop(node.condition(edge.condition), "CONTRAINDICATED_IN"),
          hop(node.ing(edge.ingredient), "CONTAINS"),
          node.med(item.medication),
        ],
      });

  // 5. Nutrient depletion, grouped so "two doctors' drugs both drain B12" reads as one finding.
  const byNutrient = new Map<string, typeof knowledge.depletions>();
  for (const d of knowledge.depletions) byNutrient.set(d.nutrient.id, [...(byNutrient.get(d.nutrient.id) ?? []), d]);
  for (const [nutrientId, edges] of byNutrient) {
    const meds = new Map<string, Medication>();
    const path: PathNode[] = [];
    for (const e of edges)
      for (const item of holders.get(e.ingredient.id) ?? []) {
        meds.set(item.medication.id, item.medication);
        path.push(hop(node.med(item.medication), "CONTAINS"), hop(node.ing(e.ingredient), "DEPLETES"));
      }
    if (!meds.size) continue;
    const nutrient = edges[0].nutrient;
    const names = [...meds.values()].map((m) => m.name);
    add({
      id: `nutrient:${nutrientId}`,
      kind: "nutrient",
      severity: meds.size > 1 ? "moderate" : "minor",
      title: meds.size > 1 ? `${names.join(" and ")} both lower ${nutrient.name}` : `${names[0]} can lower ${nutrient.name}`,
      detail: edges.map((e) => e.effect).filter((v, i, a) => a.indexOf(v) === i).join(" "),
      recommendation: edges[0].recommendation,
      medicationIds: [...meds.keys()],
      path: [...path, node.nutrient(nutrient)],
    });
  }

  const sorted = [...findings.values()].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Number(b.involvesCandidate) - Number(a.involvesCandidate) ||
      a.title.localeCompare(b.title),
  );
  const counts = { major: 0, moderate: 0, minor: 0 } as Record<Severity, number>;
  for (const f of sorted) counts[f.severity]++;

  return {
    patientId: context.patient.id,
    candidate: candidate?.medication,
    findings: sorted,
    counts,
    verdict: counts.major ? "danger" : counts.moderate ? "caution" : "clear",
    watchFoods,
    // DrugBank advice is per ingredient; it only describes how to take a product when the product
    // is that single ingredient, and sentences tied to another indication ("for motion sickness") are dropped.
    labelAdvice: knowledge.labelAdvice
      .filter((a) => !/\bfor (motion sickness|travel|nausea|migraine)|before departure/i.test(a.text))
      .flatMap((a) =>
        (holders.get(a.ingredient.id) ?? [])
          .filter((item) => item.medication.ingredients.length === 1)
          .map((item) => ({ medicationId: item.medication.id, text: a.text })),
      ),
  };
}

/** Compact subgraph for visualisation: the regimen plus every node that appears on a finding's path. */
export function buildGraphView(context: PatientContext, report: SafetyReport, candidates: RegimenItem[] = []): GraphView {
  const nodes = new Map<string, GraphView["nodes"][number]>();
  const links = new Map<string, GraphView["links"][number]>();
  const addNode = (n: PathNode, isCandidate = false) => {
    const existing = nodes.get(n.id);
    nodes.set(n.id, { id: n.id, label: n.label, name: n.name, candidate: isCandidate || existing?.candidate });
  };
  const addLink = (source: string, target: string, type: string, severity?: Severity) => {
    const key = `${source}>${target}>${type}`;
    const prev = links.get(key);
    if (prev?.severity && severity && SEVERITY_RANK[prev.severity] <= SEVERITY_RANK[severity]) return;
    links.set(key, { source, target, type, severity });
  };

  const p = node.patient(context);
  addNode(p);
  const items = [...context.regimen, ...candidates];
  for (const item of items) {
    const isCand = candidates.includes(item);
    const m = node.med(item.medication);
    addNode(m, isCand);
    addLink(p.id, m.id, isCand ? "CONSIDERING" : "TAKES");
    for (const ing of item.medication.ingredients) {
      addNode(node.ing(ing), isCand);
      addLink(m.id, `ing:${ing.id}`, "CONTAINS");
    }
  }
  for (const h of context.habits) {
    addNode(node.food(h.food));
    addLink(p.id, `food:${h.food.id}`, "CONSUMES");
  }

  for (const f of report.findings) {
    for (const n of f.path) addNode(n);
    const ings = f.path.filter((n) => n.label === "ActiveIngredient");
    const classes = f.path.filter((n) => n.label === "DrugClass");
    if (f.kind === "drug-drug" || f.kind === "timing") {
      if (classes.length === 2) {
        addLink(ings[0].id, classes[0].id, "IN_CLASS");
        addLink(ings[1].id, classes[1].id, "IN_CLASS");
        addLink(classes[0].id, classes[1].id, "CLASS_INTERACTS_WITH", f.severity);
      } else if (ings.length === 2) addLink(ings[0].id, ings[1].id, "INTERACTS_WITH", f.severity);
      else if (ings.length === 1) {
        const food = f.path.find((n) => n.label === "Food");
        if (food) addLink(ings[0].id, food.id, "CONFLICTS_WITH", f.severity);
      }
    } else if (f.kind === "food") {
      const food = f.path.find((n) => n.label === "Food")!;
      addLink(ings[0].id, food.id, "CONFLICTS_WITH", f.severity);
    } else if (f.kind === "condition") {
      const cond = f.path.find((n) => n.label === "Condition")!;
      addLink(p.id, cond.id, "HAS_CONDITION");
      addLink(ings[0].id, cond.id, "CONTRAINDICATED_IN", f.severity);
    } else if (f.kind === "nutrient") {
      const nut = f.path.find((n) => n.label === "Nutrient")!;
      for (const ing of ings) addLink(ing.id, nut.id, "DEPLETES", f.severity);
    } else if (f.kind === "duplicate" && classes.length === 1) {
      for (const mid of f.medicationIds) {
        const item = items.find((i) => i.medication.id === mid);
        for (const ing of item?.medication.ingredients ?? []) addLink(`ing:${ing.id}`, classes[0].id, "IN_CLASS", f.severity);
      }
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()].filter((l) => nodes.has(l.source) && nodes.has(l.target)) };
}

// Folds the teammate's DrugBank import ((:Drug)-[:INTERACTS_WITH_DRUG]->(:Drug),
// (:Drug)-[:HAS_FOOD_INTERACTION]->(:FoodInteraction)) into the curated knowledge slice.
//
// DrugBank's open data has no severity grades, so severity here is a conservative keyword
// heuristic capped at "moderate": unverified text can raise attention, never the verdict to "serious".

import type { FoodConflictEdge, Ingredient, InteractionEdge, KnowledgeSlice, Severity } from "../types";

const RISK_WORDS =
  /bleeding|hemorrhag|anticoagulant|antiplatelet|thrombo|serotonin|neuroexcit|qtc|torsade|arrhythm|hyperkal|hypokal|hyponatr|hypercalc|hyperglyc|hypoglyc|antihypertensive|respiratory depression|cns depress|sedation|rhabdomyolysis|myopathy|seizure|nephrotox|hepatotox|renal|kidney|toxicity|tendin|tendon|confusion|delirium|anticholinergic|hypotens|bradycard|lactic acidosis|neuromuscular/i;

// DrugBank's predicted-metabolism templates. Without a named hazard they are not actionable for
// a caregiver and would bury the real findings, so they are left out of the report.
const BOILERPLATE = /^The (metabolism|serum concentration|excretion|absorption|bioavailability|protein binding) of .+ can be (de|in)creased|^The risk or severity of adverse effects can be increased when/i;

export function ddiSeverity(description: string): Severity {
  return RISK_WORDS.test(description) ? "moderate" : "minor";
}

// Which ingredients a food pattern may apply to (by ATC prefix). The potassium warning is only
// right for medicines that RAISE potassium; for digoxin DrugBank's "avoid potassium" sentence
// would contradict the graph's own rule that low potassium makes digoxin toxic.
const FOOD_PATTERNS: { food: string; re: RegExp; onlyAtc?: string[] }[] = [
  { food: "grapefruit", re: /grapefruit/i },
  { food: "alcohol", re: /alcohol/i },
  { food: "leafy-greens", re: /vitamin k|leafy/i },
  { food: "coffee", re: /caffeine|coffee/i },
  { food: "dairy", re: /dairy|milk|calcium-rich|calcium rich/i },
  { food: "high-potassium", re: /potassium|salt substitute/i, onlyAtc: ["C09", "C03D", "A12B"] },
  { food: "cranberry", re: /cranberry/i },
];

const sentences = (text: string) =>
  text
    .replace(/\bSt\.\s*John/gi, "St John")
    .replace(/\be\.g\./gi, "eg")
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

export interface DrugBankRows {
  pairs: { a: Ingredient; b: Ingredient; description: string }[];
  food: { ingredient: Ingredient; advice: string[] }[];
}

export function mergeDrugBank(slice: KnowledgeSlice, rows: DrugBankRows, foods: Map<string, { id: string; name: string }>): KnowledgeSlice {
  const key = (a: string, b: string) => [a, b].sort().join("|");
  const known = new Map(slice.interactions.map((e) => [key(e.a.id, e.b.id), e]));
  const interactions: InteractionEdge[] = slice.interactions.map((e) => ({ ...e, source: e.source ?? "curated" }));
  const byKey = new Map(interactions.map((e) => [key(e.a.id, e.b.id), e]));

  for (const p of rows.pairs) {
    const k = key(p.a.id, p.b.id);
    if (known.has(k)) {
      const target = byKey.get(k);
      if (target) target.drugbank ??= p.description; // corroborates a curated or ontology-inferred edge
      continue;
    }
    if (BOILERPLATE.test(p.description) && !RISK_WORDS.test(p.description)) continue;
    const edge: InteractionEdge = {
      a: p.a,
      b: p.b,
      severity: ddiSeverity(p.description),
      effect: p.description,
      recommendation: "Ask the pharmacist whether this DrugBank-listed interaction matters at these doses.",
      source: "drugbank",
    };
    interactions.push(edge);
    known.set(k, edge);
  }

  const curatedFood = new Set(slice.foodConflicts.map((f) => `${f.ingredient.id}|${f.food.id}`));
  const foodConflicts: FoodConflictEdge[] = slice.foodConflicts.map((f) => ({ ...f, source: f.source ?? "curated" }));
  const labelAdvice: KnowledgeSlice["labelAdvice"] = [...slice.labelAdvice];

  for (const { ingredient, advice } of rows.food) {
    const all = advice.flatMap(sentences);
    for (const s of all) {
      const hit = /^(avoid|limit|do not|don't)\b/i.test(s)
        ? FOOD_PATTERNS.find((f) => f.re.test(s) && (!f.onlyAtc || f.onlyAtc.some((p) => ingredient.atc?.startsWith(p))))
        : undefined;
      const food = hit && foods.get(hit.food);
      if (food && !curatedFood.has(`${ingredient.id}|${food.id}`)) {
        curatedFood.add(`${ingredient.id}|${food.id}`);
        const explanation = all.find((x) => x !== s && hit!.re.test(x));
        foodConflicts.push({
          ingredient,
          food,
          // Moderate only when DrugBank names a hazard; a bare "avoid/limit" sentence is minor.
          severity: explanation && RISK_WORDS.test(explanation) ? "moderate" : "minor",
          effect: explanation ?? `${food.name} may change how ${ingredient.name} is absorbed or works (DrugBank label note).`,
          recommendation: s,
          source: "drugbank",
        });
      } else if (!food && /^(take|swallow|avoid taking)\b/i.test(s) && /\b(meal|food|water|breakfast|hour|minute|stomach|bedtime|empty)\b/i.test(s) && !/with or without food/i.test(s)) {
        labelAdvice.push({ ingredient, text: s });
      }
    }
  }

  const tidy = labelAdvice.filter((a, i, all) => {
    const t = a.text.toLowerCase().replace(/\.$/, "");
    return !all.some((b, j) => {
      if (b.ingredient.id !== a.ingredient.id || j === i) return false;
      const u = b.text.toLowerCase().replace(/\.$/, "");
      return (u !== t && u.startsWith(t)) || (u === t && j < i);
    });
  });
  return { ...slice, interactions, foodConflicts, labelAdvice: tidy };
}

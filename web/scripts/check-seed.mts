// Referential-integrity check for seed-data.ts: every edge must point at nodes that exist, every
// ingredient must sit in a known ATC class. Run: npm run check:seed
import { seed } from "../src/lib/graph/seed-data";

const ids = <T extends { id: string }>(xs: T[]) => new Set(xs.map((x) => x.id));
const cls = ids(seed.drugClasses);
const ing = ids(seed.ingredients);
const cond = ids(seed.conditions);
const nut = ids(seed.nutrients);
const food = ids(seed.foods);
const meds = ids(seed.medications);
const bad: string[] = [];

for (const c of seed.drugClasses) if (c.parent && !cls.has(c.parent)) bad.push(`class ${c.id}: unknown parent ${c.parent}`);
for (const i of seed.ingredients) if (!cls.has(i.atc.slice(0, 5))) bad.push(`ingredient ${i.id}: no ATC class ${i.atc.slice(0, 5)}`);
for (const m of seed.medications) for (const [i] of m.contains) if (!ing.has(i)) bad.push(`medication ${m.id}: unknown ingredient ${i}`);
for (const e of seed.interactions) if (!ing.has(e.a) || !ing.has(e.b)) bad.push(`interaction ${e.a}-${e.b}`);
for (const e of seed.classInteractions) if (!cls.has(e.a) || !cls.has(e.b)) bad.push(`class rule ${e.a}-${e.b}`);
for (const e of seed.foodConflicts) if (!ing.has(e.ingredient) || !food.has(e.food)) bad.push(`food ${e.ingredient}-${e.food}`);
for (const e of seed.depletions) if (!ing.has(e.ingredient) || !nut.has(e.nutrient)) bad.push(`depletion ${e.ingredient}-${e.nutrient}`);
for (const e of seed.contraindications) if (!ing.has(e.ingredient) || !cond.has(e.condition)) bad.push(`contraindication ${e.ingredient}-${e.condition}`);
for (const p of seed.patients) {
  for (const t of p.takes) if (!meds.has(t.medication)) bad.push(`patient ${p.id}: unknown medication ${t.medication}`);
  for (const c of p.conditions) if (!cond.has(c)) bad.push(`patient ${p.id}: unknown condition ${c}`);
  for (const c of p.consumes) if (!food.has(c.food)) bad.push(`patient ${p.id}: unknown food ${c.food}`);
}
const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
for (const d of dupes(seed.ingredients.map((i) => i.id))) bad.push(`duplicate ingredient ${d}`);
for (const d of dupes(seed.medications.map((m) => m.id))) bad.push(`duplicate medication ${d}`);
for (const d of dupes(seed.drugClasses.map((c) => c.id))) bad.push(`duplicate class ${d}`);
for (const d of dupes(seed.interactions.map((e) => [e.a, e.b].sort().join("|")))) bad.push(`duplicate interaction ${d}`);

console.log(
  `${seed.ingredients.length} ingredients, ${seed.medications.length} medicines, ${seed.drugClasses.length} ATC classes, ` +
    `${seed.interactions.length} interactions, ${seed.classInteractions.length} class rules, ${seed.foodConflicts.length} food conflicts, ` +
    `${seed.contraindications.length} condition rules, ${seed.depletions.length} depletions`,
);
if (bad.length) {
  console.error("Integrity problems:\n" + bad.map((b) => "  - " + b).join("\n"));
  process.exit(1);
}
console.log("Integrity OK");

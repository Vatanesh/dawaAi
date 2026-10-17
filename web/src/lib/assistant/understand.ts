// Maps a caregiver's plain-language question onto graph entities, without an LLM.
// Everyday phrases ("blood thinner", "sleeping pill") resolve to ATC classes in the ontology,
// so the answer stays grounded in the graph whatever words the caregiver uses.

import type { Medication, PatientContext, RegimenItem, Slot } from "../types";

export interface ClassPhrase {
  phrase: string;
  label: string;
  atcPrefixes: string[];
}

const CLASS_PHRASES: ClassPhrase[] = [
  { phrase: "blood thinner|anticoagulant|anti-coagulant", label: "blood thinners (anticoagulants)", atcPrefixes: ["B01AA", "B01AF"] },
  { phrase: "antiplatelet", label: "antiplatelet medicines", atcPrefixes: ["B01AC"] },
  { phrase: "pain ?killer|pain reliever|pain medicine|pain tablet|pain pill", label: "pain relievers", atcPrefixes: ["N02", "M01A"] },
  { phrase: "anti-inflammator(y|ies)|nsaids?", label: "NSAID pain relievers", atcPrefixes: ["M01A"] },
  { phrase: "statins?|cholesterol (pill|medicine|tablet)", label: "statins", atcPrefixes: ["C10AA"] },
  { phrase: "antibiotics?", label: "antibiotics", atcPrefixes: ["J01"] },
  { phrase: "sleeping (pill|tablet)s?|sleep aids?|sleep medicine", label: "sleep medicines", atcPrefixes: ["N05C", "R06AA"] },
  { phrase: "antidepressants?", label: "antidepressants", atcPrefixes: ["N06A"] },
  { phrase: "water pills?|diuretics?", label: "diuretics", atcPrefixes: ["C03"] },
];

export const FOOD_WORDS: Record<string, string[]> = {
  grapefruit: ["grapefruit"],
  "leafy-greens": ["leafy greens", "greens", "spinach", "kale", "saag", "palak", "salad"],
  alcohol: ["alcohol", "wine", "beer", "whisky", "whiskey", "spirits", "booze", "pint", "a drink", "drinks"],
  coffee: ["coffee", "caffeine", "espresso"],
  dairy: ["milk", "dairy", "yoghurt", "yogurt", "cheese"],
  cranberry: ["cranberry"],
  "high-potassium": ["banana", "bananas", "salt substitute", "lo salt", "potassium salt"],
};

const SLOT_WORDS: Record<Slot, string[]> = {
  morning: ["morning", "breakfast"],
  midday: ["midday", "lunch", "afternoon", "noon"],
  evening: ["evening", "dinner", "night"],
  bedtime: ["bedtime", "bed time", "before bed"],
};

// Everyday ways of naming a medicine by what it is for; matched against each regimen item's
// purpose, drug class and description.
const PURPOSE_WORDS: { phrase: RegExp; matches: RegExp }[] = [
  { phrase: /blood pressure|bp (pill|tablet|med)|hypertension/i, matches: /blood pressure|hypertens|ace inhibitor|beta blocker|calcium channel|angiotensin|diuretic/i },
  { phrase: /cholesterol|statin/i, matches: /cholesterol|statin/i },
  { phrase: /sugar|diabet|insulin/i, matches: /blood sugar|diabet/i },
  { phrase: /thyroid/i, matches: /thyroid/i },
  { phrase: /heartburn|acid|reflux|stomach|indigestion/i, matches: /heartburn|acid|reflux|stomach/i },
  { phrase: /pain|ache/i, matches: /\bpain\b|nsaid|opioid|analges/i },
  { phrase: /sleep|insomnia/i, matches: /sleep|hypnotic/i },
  { phrase: /mood|depress|anxiety|nerves/i, matches: /mood|depress|antidepress|anxiety|benzodiazepine/i },
  { phrase: /water pill|diuretic|fluid/i, matches: /diuretic|water pill/i },
  { phrase: /heart (pill|tablet|med|rhythm)|rhythm|afib|fibrillation/i, matches: /heart|rhythm|cardiac|antiarrhythm/i },
  { phrase: /antibiotic|infection/i, matches: /antibiotic|antifung/i },
  { phrase: /bone|osteoporosis/i, matches: /bone/i },
  { phrase: /memory|dementia/i, matches: /dementia|memory/i },
];

// Everyday words for health conditions, matched against the person's recorded conditions.
const CONDITION_WORDS: RegExp[] = [
  /diabet|sugar/i, /kidney|renal/i, /heart failure/i, /blood pressure|hypertens/i, /thyroid/i, /reflux|heartburn|gerd/i,
  /insomnia|sleep/i, /depress|mood/i, /osteoporosis|bones?\b/i, /fall/i, /dementia|memory/i, /ulcer/i, /arthritis|joints?/i, /fibrillation|afib|rhythm/i,
];

export interface Understanding {
  /** Medicines named in the question that the patient does not take yet. */
  candidates: Medication[];
  /** A class the caregiver named generically ("a new blood thinner") with no specific drug. */
  classAsked?: ClassPhrase & { options: Medication[] };
  /** Medicines from the current regimen the question is about. */
  focusRegimen: RegimenItem[];
  foods: { id: string; name: string }[];
  /** Conditions on the person's record that the question mentions. */
  conditions: { id: string; name: string }[];
  slots: Slot[];
  /** The caregiver asked for the whole picture ("everything", "overall", "summary"). */
  overview: boolean;
}

const wordRe = (w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()[\]\\]/g, "\\$&")}\\b`, "i");

export function understand(
  question: string,
  context: PatientContext,
  catalog: Medication[],
  foods: { id: string; name: string }[],
): Understanding {
  const q = question.toLowerCase();
  const takenIds = new Set(context.regimen.map((r) => r.medication.id));

  // Specific medicines by brand, product or ingredient name. Longest names first so
  // "Tylenol PM" wins over "Tylenol".
  const names = catalog
    .flatMap((m) => [m.name, m.brand, ...(m.ingredients.length === 1 ? m.ingredients.map((i) => i.name.replace(/\s*\(.*\)/, "")) : [])]
      .filter((n): n is string => !!n && n.length > 3)
      .map((n) => ({ n: n.toLowerCase(), m })))
    .sort((a, b) => b.n.length - a.n.length);
  let masked = q;
  const mentioned = new Map<string, Medication>();
  for (const { n, m } of names) {
    const re = wordRe(n);
    if (re.test(masked)) {
      // Prefer the product the patient already takes when an ingredient name is shared.
      const single = (x: Medication) => (x.ingredients.length === 1 ? x.ingredients[0].id : null);
      const owned = single(m) && context.regimen.find((r) => single(r.medication) === single(m));
      const pick = owned ? owned.medication : m;
      mentioned.set(pick.id, pick);
      masked = masked.replace(re, " ");
    }
  }

  const slots = (Object.keys(SLOT_WORDS) as Slot[]).filter((s) => SLOT_WORDS[s].some((w) => wordRe(w).test(q)));
  const focusRegimen = context.regimen.filter((r) => mentioned.has(r.medication.id));
  if (/\b(vitamins?|supplements?|multivitamins?|fish oil)\b/i.test(q)) {
    for (const r of context.regimen)
      if (r.medication.kind === "supplement" && (!slots.length || r.slots.some((s) => slots.includes(s))) && !focusRegimen.includes(r))
        focusRegimen.push(r);
  }

  // Medicines named by what they are for: "his blood pressure tablets", "the thyroid pill".
  for (const p of PURPOSE_WORDS) {
    if (!p.phrase.test(q)) continue;
    for (const r of context.regimen) {
      const about = `${r.purpose ?? ""} ${r.medication.description ?? ""} ${r.medication.ingredients.map((i) => i.drugClass ?? "").join(" ")}`;
      if (p.matches.test(about) && !focusRegimen.includes(r)) focusRegimen.push(r);
    }
  }

  // Conditions the person has, when the question names one.
  const conditions = context.patient.conditions.filter((c) => {
    const words = `${c.name} ${c.id}`.toLowerCase();
    return CONDITION_WORDS.some((re) => re.test(q) && re.test(words)) || wordRe(c.name.toLowerCase().replace(/\s*\(.*\)/, "")).test(q);
  });

  const overview = /\b(everything|all (of )?(his|her|their|the) (medicines|meds|pills|tablets)|overall|summary|summari[sz]e|whole list|full picture|review)\b/i.test(q);

  const candidates = [...mentioned.values()].filter((m) => !takenIds.has(m.id));

  let classAsked: Understanding["classAsked"];
  if (!candidates.length) {
    const hit = CLASS_PHRASES.find((c) => new RegExp(`\\b(${c.phrase})\\b`, "i").test(q));
    if (hit) {
      const inClass = (m: Medication) => m.ingredients.some((i) => hit.atcPrefixes.some((p) => i.atc?.startsWith(p)));
      const alreadyTaking = context.regimen.filter((r) => inClass(r.medication));
      if (alreadyTaking.length) focusRegimen.push(...alreadyTaking.filter((r) => !focusRegimen.includes(r)));
      else classAsked = { ...hit, options: catalog.filter((m) => inClass(m) && m.kind !== "supplement") };
    }
  }

  const foodHits = foods.filter((f) => (FOOD_WORDS[f.id] ?? [f.name.toLowerCase()]).some((w) => wordRe(w).test(q)));

  return { candidates, classAsked, focusRegimen, foods: foodHits, conditions, slots, overview };
}

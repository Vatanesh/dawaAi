// In-memory implementation of the graph contract, built from seed-data.ts.
// Used when NEO4J_URI is not configured so the app runs with zero setup.

import type {
  DrugClassRef,
  Ingredient,
  InteractionEdge,
  KnowledgeSlice,
  Medication,
  PatientContext,
  PatientInput,
  PatientSummary,
} from "../types";
import { seed } from "./seed-data";
import { newPatientId, normalise, slugify, type GraphRepository, type GraphStats, type RegimenInput } from "./repository";

type SeedPatient = (typeof seed.patients)[number];

const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((x) => [x.id, x]));

const ingredients = byId(seed.ingredients);
const medications = byId(seed.medications);
const foods = byId(seed.foods);
const nutrients = byId(seed.nutrients);
const conditions = new Map<string, { id: string; name: string; icd10?: string }>(seed.conditions.map((c) => [c.id, c]));
const drugClasses = byId(seed.drugClasses);

function ingredient(id: string, strength?: string): Ingredient {
  const i = ingredients.get(id)!;
  return { id: i.id, name: i.name, drugClass: i.drugClass, atc: i.atc, ...(strength ? { strength } : {}) };
}

function medication(id: string): Medication | null {
  const m = medications.get(id);
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    brand: m.brand,
    kind: m.kind,
    description: m.description,
    ingredients: m.contains.map(([iid, strength]) => ingredient(iid, strength)),
  };
}

/** ATC ancestry for an ingredient, most specific class first (level 4 -> level 1). */
function ancestry(ingredientId: string): DrugClassRef[] {
  const atc = ingredients.get(ingredientId)?.atc;
  if (!atc) return [];
  const chain: DrugClassRef[] = [];
  let cls = drugClasses.get(atc.slice(0, 5));
  while (cls) {
    chain.push({ id: cls.id, name: cls.name });
    cls = cls.parent ? drugClasses.get(cls.parent) : undefined;
  }
  return chain;
}

export class DemoRepository implements GraphRepository {
  readonly source = "demo" as const;
  // Copy so regimen edits during a session don't mutate the seed module.
  private patients: SeedPatient[] = structuredClone(seed.patients);

  async listPatients(): Promise<PatientSummary[]> {
    return this.patients.map((p) => ({
      id: p.id,
      name: p.name,
      age: p.age,
      sex: p.sex,
      relation: p.relation,
      medicationCount: p.takes.length,
    }));
  }

  async getPatientContext(patientId: string): Promise<PatientContext | null> {
    const p = this.patients.find((x) => x.id === patientId);
    if (!p) return null;
    return {
      patient: {
        id: p.id,
        name: p.name,
        age: p.age,
        sex: p.sex,
        relation: p.relation,
        conditions: p.conditions.map((c) => conditions.get(c)!),
      },
      regimen: p.takes.map((t) => ({
        medication: medication(t.medication)!,
        dose: t.dose,
        slots: t.slots,
        prescriber: t.prescriber,
        purpose: t.purpose,
        since: t.since,
      })),
      habits: p.consumes.map((c) => ({ food: foods.get(c.food)!, frequency: c.frequency, slot: c.slot })),
    };
  }

  async getMedication(medicationId: string) {
    return medication(medicationId);
  }

  async searchMedications(query: string, limit = 8): Promise<Medication[]> {
    const q = normalise(query);
    if (!q) return [];
    const scored = seed.medications
      .map((m) => {
        const hay = normalise([m.name, m.brand, m.description, ...m.contains.map(([i]) => ingredients.get(i)!.name)].join(" "));
        const name = normalise(`${m.name} ${m.brand ?? ""}`);
        const score = name.startsWith(q) ? 3 : name.includes(q) ? 2 : hay.includes(q) ? 1 : 0;
        return { m, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name));
    return scored.slice(0, limit).map((x) => medication(x.m.id)!);
  }

  async listMedications() {
    return seed.medications.map((m) => medication(m.id)!);
  }

  async listFoods() {
    return seed.foods;
  }

  async searchFoods(query: string) {
    const q = normalise(query);
    return seed.foods.filter((f) => normalise(f.name).includes(q) || q.includes(normalise(f.name).split(" ")[0]));
  }

  async getKnowledge(ingredientIds: string[], conditionIds: string[]): Promise<KnowledgeSlice> {
    const ids = new Set(ingredientIds);
    const conds = new Set(conditionIds);

    const interactions: InteractionEdge[] = seed.interactions
      .filter((e) => ids.has(e.a) && ids.has(e.b))
      .map((e) => ({ ...e, a: ingredient(e.a), b: ingredient(e.b) }));

    // Ontology inference: a class rule applies to any pair of ingredients whose ATC
    // ancestry contains the two classes, unless an explicit ingredient edge already exists.
    const classOf: Record<string, DrugClassRef[]> = {};
    for (const id of ids) classOf[id] = ancestry(id);
    const explicit = new Set(interactions.map((e) => [e.a.id, e.b.id].sort().join("|")));
    const list = [...ids];
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const [i, j] = [list[x], list[y]];
        if (explicit.has([i, j].sort().join("|"))) continue;
        const ci = new Set(classOf[i].map((c) => c.id));
        const cj = new Set(classOf[j].map((c) => c.id));
        for (const rule of seed.classInteractions) {
          const forward = ci.has(rule.a) && cj.has(rule.b);
          const reverse = ci.has(rule.b) && cj.has(rule.a);
          if (!forward && !reverse) continue;
          const [ia, ib] = forward ? [i, j] : [j, i];
          interactions.push({
            a: ingredient(ia),
            b: ingredient(ib),
            severity: rule.severity,
            effect: rule.effect,
            recommendation: rule.recommendation,
            inferredVia: {
              a: { id: rule.a, name: drugClasses.get(rule.a)!.name },
              b: { id: rule.b, name: drugClasses.get(rule.b)!.name },
            },
          });
          break;
        }
      }
    }

    return {
      interactions,
      classOf,
      foodConflicts: seed.foodConflicts
        .filter((e) => ids.has(e.ingredient))
        .map((e) => ({ ...e, ingredient: ingredient(e.ingredient), food: foods.get(e.food)! })),
      depletions: seed.depletions
        .filter((e) => ids.has(e.ingredient))
        .map((e) => ({ ...e, ingredient: ingredient(e.ingredient), nutrient: nutrients.get(e.nutrient)! })),
      contraindications: seed.contraindications
        .filter((e) => ids.has(e.ingredient) && conds.has(e.condition))
        .map((e) => ({ ...e, ingredient: ingredient(e.ingredient), condition: conditions.get(e.condition)! })),
      labelAdvice: [],
    };
  }

  async addToRegimen(patientId: string, input: RegimenInput) {
    const p = this.patients.find((x) => x.id === patientId);
    if (!p || !medications.has(input.medicationId)) throw new Error("Unknown patient or medication");
    p.takes = p.takes.filter((t) => t.medication !== input.medicationId);
    p.takes.push({
      medication: input.medicationId,
      dose: input.dose,
      slots: input.slots,
      prescriber: input.prescriber ?? "Not recorded",
      purpose: input.purpose ?? "",
      since: new Date().toISOString().slice(0, 10),
    });
  }

  async removeFromRegimen(patientId: string, medicationId: string) {
    const p = this.patients.find((x) => x.id === patientId);
    if (p) p.takes = p.takes.filter((t) => t.medication !== medicationId);
  }

  async listConditions() {
    return [...conditions.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createPatient(input: PatientInput) {
    const id = newPatientId(input.name);
    this.patients.push({ id, name: input.name, age: input.age, sex: input.sex ?? "", relation: input.relation ?? "", conditions: [], takes: [], consumes: [] });
    await this.updatePatient(id, input);
    return id;
  }

  async updatePatient(patientId: string, input: Partial<PatientInput>) {
    const p = this.patients.find((x) => x.id === patientId);
    if (!p) throw new Error("Unknown patient");
    if (input.name !== undefined) p.name = input.name;
    if (input.age !== undefined) p.age = input.age;
    if (input.sex !== undefined) p.sex = input.sex;
    if (input.relation !== undefined) p.relation = input.relation;
    if (input.conditions)
      p.conditions = input.conditions.map((c) => {
        const id = c.id ?? slugify(c.name);
        if (!conditions.has(id)) conditions.set(id, { id, name: c.name });
        return id;
      });
    if (input.habits) p.consumes = input.habits.filter((h) => foods.has(h.foodId)).map((h) => ({ food: h.foodId, frequency: h.frequency, slot: h.slot }));
  }

  async deletePatient(patientId: string) {
    this.patients = this.patients.filter((p) => p.id !== patientId);
  }

  async findDrugNames() {
    return [];
  }

  async stats(): Promise<GraphStats> {
    return {
      drugs: 0,
      drugInteractions: 0,
      foodAdvice: 0,
      medicines: seed.medications.length,
      ingredients: seed.ingredients.length,
      curatedRules: seed.interactions.length + seed.classInteractions.length + seed.foodConflicts.length + seed.depletions.length + seed.contraindications.length,
      drugClasses: seed.drugClasses.length,
      conditions: conditions.size,
      people: this.patients.length,
      regimenEntries: this.patients.reduce((n, p) => n + p.takes.length, 0),
      checksLogged: 0,
      careNotes: 0,
      source: "demo",
    };
  }
}

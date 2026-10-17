// Domain types shared by the graph layer, the safety engine, the API and the UI.
// They mirror the Neo4j contract documented in /neo4j/CONTRACT.md.

export type Severity = "major" | "moderate" | "minor";
export type Slot = "morning" | "midday" | "evening" | "bedtime";
export type MedicationKind = "prescription" | "otc" | "supplement";

export const SLOTS: Slot[] = ["morning", "midday", "evening", "bedtime"];

export interface PatientSummary {
  id: string;
  name: string;
  age: number;
  sex?: string;
  relation?: string; // how the caregiver refers to them, e.g. "Dad"
  medicationCount: number;
}

export interface Ingredient {
  id: string;
  name: string;
  drugClass?: string;
  atc?: string; // WHO ATC code, e.g. B01AA03
  strength?: string;
}

export interface DrugClassRef {
  id: string; // ATC class code, e.g. B01A
  name: string;
}

export interface Medication {
  id: string;
  name: string;
  brand?: string;
  kind: MedicationKind;
  description?: string;
  ingredients: Ingredient[];
  source?: "curated" | "drugbank"; // drugbank = any of the 2k+ drugs in the imported DrugBank layer
}

export interface RegimenItem {
  medication: Medication;
  dose: string;
  slots: Slot[];
  prescriber?: string;
  purpose?: string;
  since?: string;
}

export interface Habit {
  food: { id: string; name: string };
  frequency: string;
  slot?: Slot;
}

export interface PatientContext {
  patient: Omit<PatientSummary, "medicationCount"> & { conditions: { id: string; name: string; icd10?: string }[] };
  regimen: RegimenItem[];
  habits: Habit[];
}

// Edges from the knowledge graph that touch the patient's ingredients.
export interface InteractionEdge {
  a: Ingredient;
  b: Ingredient;
  severity: Severity;
  effect: string;
  mechanism?: string;
  recommendation: string;
  separateHours?: number;
  // Set when the edge was inferred from a class-level rule in the ATC ontology.
  inferredVia?: { a: DrugClassRef; b: DrugClassRef };
  source?: "curated" | "drugbank";
  drugbank?: string; // DrugBank's own wording for this pair, when the imported dataset has it
}
export interface FoodConflictEdge {
  ingredient: Ingredient;
  food: { id: string; name: string };
  severity: Severity;
  effect: string;
  recommendation: string;
  separateHours?: number;
  source?: "curated" | "drugbank";
}
export interface DepletionEdge {
  ingredient: Ingredient;
  nutrient: { id: string; name: string };
  effect: string;
  recommendation: string;
}
export interface ContraindicationEdge {
  ingredient: Ingredient;
  condition: { id: string; name: string };
  severity: Severity;
  effect: string;
  recommendation: string;
}

export interface KnowledgeSlice {
  interactions: InteractionEdge[]; // explicit ingredient edges + class-inferred ones
  classOf: Record<string, DrugClassRef[]>; // ingredientId -> ATC ancestry, most specific first
  foodConflicts: FoodConflictEdge[];
  depletions: DepletionEdge[];
  contraindications: ContraindicationEdge[];
  labelAdvice: { ingredient: Ingredient; text: string }[]; // DrugBank "how to take" guidance
}

export type FindingKind = "drug-drug" | "duplicate" | "food" | "condition" | "nutrient" | "timing";

export interface PathNode {
  label: "Patient" | "Medication" | "ActiveIngredient" | "DrugClass" | "Food" | "Nutrient" | "Condition";
  id: string;
  name: string;
  rel?: string; // relationship type to the next node in the path, e.g. TAKES, CONTAINS, INTERACTS_WITH
}

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
  medicationIds: string[];
  involvesCandidate: boolean;
  path: PathNode[]; // the graph path that produced the finding, for display & citation
  source?: "curated" | "drugbank";
  evidence?: string; // corroborating DrugBank text
}

export interface SafetyReport {
  patientId: string;
  candidate?: Medication;
  findings: Finding[];
  counts: Record<Severity, number>;
  verdict: "clear" | "caution" | "danger";
  watchFoods: FoodConflictEdge[]; // conflicts with foods the patient doesn't currently report
  labelAdvice: { medicationId: string; text: string }[];
}

export interface GraphView {
  nodes: { id: string; label: PathNode["label"]; name: string; candidate?: boolean }[];
  links: { source: string; target: string; type: string; severity?: Severity }[];
}

export interface ScheduleMove {
  medicationId: string;
  name: string;
  from: Slot[];
  to: Slot[];
  reason: string;
}

export interface SchedulePlan {
  moves: ScheduleMove[];
  tips: { findingId: string; text: string }[]; // timing advice that isn't a slot move (e.g. coffee after a pill)
  clashesBefore: number;
  clashesAfter: number;
}

export interface PatientInput {
  name: string;
  age: number;
  sex?: string;
  relation?: string;
  conditions: { id?: string; name: string }[];
  habits: { foodId: string; frequency: string; slot?: Slot }[];
}

export interface PatientOverview extends PatientSummary {
  verdict: SafetyReport["verdict"];
  counts: Record<Severity, number>;
  top?: { title: string; severity: Severity };
  prescribers: number;
  conditions: string[];
  timingClashes: number;
}

export interface SafetyResponse {
  context: PatientContext;
  report: SafetyReport;
  graph: GraphView;
  schedule: SchedulePlan;
  source: "neo4j" | "demo";
}

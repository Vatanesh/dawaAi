import type {
  KnowledgeSlice,
  Medication,
  PatientContext,
  PatientInput,
  PatientSummary,
  Slot,
} from "../types";

export interface RegimenInput {
  medicationId: string;
  dose: string;
  slots: Slot[];
  prescriber?: string;
  purpose?: string;
}

export interface GraphRepository {
  readonly source: "neo4j" | "demo";
  listPatients(): Promise<PatientSummary[]>;
  getPatientContext(patientId: string): Promise<PatientContext | null>;
  getMedication(medicationId: string): Promise<Medication | null>;
  searchMedications(query: string, limit?: number): Promise<Medication[]>;
  listMedications(): Promise<Medication[]>;
  listFoods(): Promise<{ id: string; name: string }[]>;
  searchFoods(query: string): Promise<{ id: string; name: string }[]>;
  /** Every knowledge edge touching these ingredients, including class-level rules inferred through the ATC ontology. */
  getKnowledge(ingredientIds: string[], conditionIds: string[]): Promise<KnowledgeSlice>;
  addToRegimen(patientId: string, input: RegimenInput): Promise<void>;
  removeFromRegimen(patientId: string, medicationId: string): Promise<void>;

  listConditions(): Promise<{ id: string; name: string; icd10?: string }[]>;
  createPatient(input: PatientInput): Promise<string>;
  updatePatient(patientId: string, input: Partial<PatientInput>): Promise<void>;
  deletePatient(patientId: string): Promise<void>;
  /** DrugBank drug names that appear in free text (empty without the DrugBank layer). */
  findDrugNames(text: string): Promise<string[]>;
  /** Optional: open connections and fill caches ahead of the first request. */
  warm?(): Promise<void>;
  /** Live counts for the About page: every number is a database count. */
  stats(): Promise<GraphStats>;
}

export interface GraphStats {
  drugs: number; // DrugBank layer
  drugInteractions: number; // (:Drug)-[:INTERACTS_WITH_DRUG]->(:Drug)
  foodAdvice: number; // (:FoodInteraction)
  medicines: number; // curated products
  ingredients: number;
  curatedRules: number; // INTERACTS_WITH + CLASS_INTERACTS_WITH + CONFLICTS_WITH + DEPLETES + CONTRAINDICATED_IN
  drugClasses: number; // WHO ATC
  conditions: number;
  people: number;
  regimenEntries: number; // (:Patient)-[:TAKES]->()
  checksLogged: number; // reasoning traces in agent memory
  careNotes: number;
  source: "neo4j" | "demo";
}

export const DRUGBANK_PREFIX = "drugbank:";

const globalForRepo = globalThis as unknown as { __dawaRepo?: Promise<GraphRepository> };

export function getRepository(): Promise<GraphRepository> {
  // Cached on globalThis so dev-server hot reloads reuse one driver / one demo store.
  globalForRepo.__dawaRepo ??= (async () => {
    if (process.env.NEO4J_URI) {
      const { Neo4jRepository } = await import("./neo4j-repository");
      return new Neo4jRepository();
    }
    const { DemoRepository } = await import("./demo-repository");
    return new DemoRepository();
  })();
  return globalForRepo.__dawaRepo;
}

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function slugify(text: string): string {
  return normalise(text).replace(/ /g, "-").slice(0, 48) || "item";
}

export const newPatientId = (name: string) => `${slugify(name.split(" ")[0])}-${Math.random().toString(36).slice(2, 6)}`;

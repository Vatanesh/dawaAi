// Neo4j implementation of the graph contract (see /neo4j/CONTRACT.md).

import neo4j, { type Driver } from "neo4j-driver";
import type {
  DrugClassRef,
  InteractionEdge,
  KnowledgeSlice,
  Medication,
  PatientContext,
  PatientInput,
  PatientSummary,
} from "../types";
import { mergeDrugBank, type DrugBankRows } from "./drugbank";
import { DRUGBANK_PREFIX, newPatientId, slugify, type GraphRepository, type GraphStats, type MemoryReads, type RegimenInput } from "./repository";

const ING = "{.id, .name, .drugClass, .atc}";
const MED_PROJECTION = `m{.id, .name, .brand, .kind, .description, .source,
  ingredients: [(m)-[k:CONTAINS]->(i:ActiveIngredient) | i{.id, .name, .drugClass, .atc, strength: k.strength}]}`;

export class Neo4jRepository implements GraphRepository {
  readonly source = "neo4j" as const;
  private driver: Driver;
  private database: string;

  constructor() {
    this.driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USERNAME ?? "neo4j", process.env.NEO4J_PASSWORD ?? ""),
      // Test pooled connections idle for 30s+ before reuse: Aura drops idle sockets, and a dead
      // socket otherwise costs a long timeout on the next query.
      { disableLosslessIntegers: true, connectionLivenessCheckTimeout: 30_000, maxConnectionLifetime: 30 * 60_000 },
    );
    this.database = process.env.NEO4J_DATABASE ?? "neo4j";
  }

  private async read<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}) {
    const { records } = await this.driver.executeQuery(cypher, params, {
      database: this.database,
      routing: neo4j.routing.READ,
    });
    return records.map((r) => r.toObject() as T);
  }

  private async write(cypher: string, params: Record<string, unknown>) {
    await this.driver.executeQuery(cypher, params, { database: this.database });
  }

  // Catalogue lists change rarely; cache them briefly. Cleared whenever a new medicine is materialised.
  private cache = new Map<string, { at: number; value: Promise<unknown> }>();
  private cached<T>(key: string, load: () => Promise<T>, ttl = 60_000): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
    const value = load().catch((err) => {
      this.cache.delete(key);
      throw err;
    });
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async stats(): Promise<GraphStats> {
    const [row] = await this.read<Omit<GraphStats, "source">>(
      `RETURN COUNT { (:Drug) } AS drugs,
              COUNT { ()-[:INTERACTS_WITH_DRUG]->() } AS drugInteractions,
              COUNT { (:FoodInteraction) } AS foodAdvice,
              COUNT { (:Medication) } AS medicines,
              COUNT { (:ActiveIngredient) } AS ingredients,
              COUNT { ()-[:INTERACTS_WITH]->() } + COUNT { ()-[:CLASS_INTERACTS_WITH]->() } + COUNT { ()-[:CONFLICTS_WITH]->() }
                + COUNT { ()-[:DEPLETES]->() } + COUNT { ()-[:CONTRAINDICATED_IN]->() } AS curatedRules,
              COUNT { (:DrugClass) } AS drugClasses,
              COUNT { (:Condition) } AS conditions,
              COUNT { (:Patient) } AS people,
              COUNT { (:Patient)-[:TAKES]->() } AS regimenEntries,
              COUNT { (:ReasoningTrace) } AS checksLogged,
              COUNT { (c:Conversation)-[:HAS_MESSAGE]->(:Message) WHERE c.session_id STARTS WITH 'care:' } AS careNotes`,
    );
    return { ...row, source: "neo4j" };
  }

  // The neo4j-agent-memory sidecar owns these nodes; this only reads them, for deployments where the
  // sidecar is not reachable (e.g. the web app on Vercel with the sidecar on a laptop).
  memoryReads: MemoryReads = {
    notes: async (patientId) => {
      const rows = await this.read<{ id: string; text: string; role: string; metadata: string | null; createdAt: string; mentions: { name: string; type: string; ref: string | null }[] }>(
        `MATCH (c:Conversation {session_id: $session})-[:HAS_MESSAGE]->(m:Message)
         OPTIONAL MATCH (m)-[:MENTIONS]->(e:Entity) WHERE e.type <> 'CareRecipient'
         OPTIONAL MATCH (e)-[:REFERS_TO]->(n)
         WITH m, collect(DISTINCT CASE WHEN e IS NULL THEN null ELSE {name: e.name, type: e.type, ref: n.id} END) AS mentions
         RETURN m.id AS id, m.content AS text, m.role AS role, m.metadata AS metadata, toString(m.timestamp) AS createdAt,
                [x IN mentions WHERE x IS NOT NULL] AS mentions
         ORDER BY m.timestamp DESC LIMIT 50`,
        { session: `care:${patientId}` },
      );
      return rows.map((r) => {
        let meta: { kind?: string; author?: string | null } = {};
        try {
          meta = r.metadata ? JSON.parse(r.metadata) : {};
        } catch {
          // Unreadable metadata: treat as a plain observation.
        }
        return { id: r.id, text: r.text, role: r.role, kind: meta.kind ?? "observation", author: meta.author ?? null, createdAt: r.createdAt, mentions: r.mentions };
      });
    },
    chat: (patientId, limit) =>
      this.read<{ role: string; text: string; createdAt: string }>(
        `MATCH (c:Conversation {session_id: $session})-[:HAS_MESSAGE]->(m:Message)
         WITH m ORDER BY m.timestamp DESC LIMIT $limit
         RETURN m.role AS role, m.content AS text, toString(m.timestamp) AS createdAt ORDER BY m.timestamp ASC`,
        { session: `chat:${patientId}`, limit: neo4j.int(limit) },
      ),
    traces: async (patientId, limit) => {
      const rows = await this.read<{ id: string; task: string; outcome: string | null; success: boolean | null; startedAt: string; steps: { thought: string | null; action: string | null; observation: string | null; step: number; tools: { name: string; arguments: string }[] }[] }>(
        `MATCH (t:ReasoningTrace {session_id: $session})
         WITH t ORDER BY t.started_at DESC LIMIT $limit
         OPTIONAL MATCH (t)-[:HAS_STEP]->(s:ReasoningStep)
         OPTIONAL MATCH (s)-[:USES_TOOL]->(x:ToolCall)
         WITH t, s, collect(CASE WHEN x IS NULL THEN null ELSE {name: x.tool_name, arguments: x.arguments} END) AS tools
         WITH t, collect(CASE WHEN s IS NULL THEN null ELSE {thought: s.thought, action: s.action, observation: s.observation, step: s.step_number, tools: [y IN tools WHERE y IS NOT NULL]} END) AS steps
         RETURN t.id AS id, t.task AS task, t.outcome AS outcome, t.success AS success, toString(t.started_at) AS startedAt,
                [z IN steps WHERE z IS NOT NULL] AS steps
         ORDER BY t.started_at DESC`,
        { session: `checks:${patientId}`, limit: neo4j.int(limit) },
      );
      return rows.map((r) => ({ ...r, steps: [...r.steps].sort((a, b) => a.step - b.step).map(({ step: _s, ...rest }) => rest) }));
    },
  };

  async warm() {
    await this.driver.verifyConnectivity({ database: this.database });
    await Promise.all([this.listMedications(), this.listFoods(), this.listConditions(), this.findDrugNames("")]);
  }

  async listPatients(): Promise<PatientSummary[]> {
    return this.read<PatientSummary>(
      `MATCH (p:Patient)
       RETURN p.id AS id, p.name AS name, p.age AS age, p.sex AS sex, p.relation AS relation,
              COUNT { (p)-[:TAKES]->(:Medication) } AS medicationCount
       ORDER BY medicationCount DESC, name`,
    );
  }

  async getPatientContext(patientId: string): Promise<PatientContext | null> {
    const [row] = await this.read<PatientContext>(
      `MATCH (p:Patient {id: $id})
       RETURN p{.id, .name, .age, .sex, .relation,
                conditions: [(p)-[:HAS_CONDITION]->(c:Condition) | c{.id, .name, .icd10}]} AS patient,
              [(p)-[t:TAKES]->(m:Medication) | {
                  medication: ${MED_PROJECTION},
                  dose: t.dose, slots: coalesce(t.slots, []), prescriber: t.prescriber,
                  purpose: t.purpose, since: toString(t.since)}] AS regimen,
              [(p)-[h:CONSUMES]->(f:Food) | {food: f{.id, .name}, frequency: h.frequency, slot: h.slot}] AS habits`,
      { id: patientId },
    );
    return row ?? null;
  }

  async getMedication(medicationId: string): Promise<Medication | null> {
    // A DrugBank drug the curated catalogue doesn't have yet: give it a Medication + ActiveIngredient
    // bridged with SAME_AS so the engine can reason about it. Never edits the Drug node itself.
    if (medicationId.startsWith(DRUGBANK_PREFIX)) {
      const name = medicationId.slice(DRUGBANK_PREFIX.length);
      const id = `db-${slugify(name)}`;
      await this.write(
        `MATCH (d:Drug {name: $name})
         MERGE (i:ActiveIngredient {id: $id}) ON CREATE SET i.name = d.name, i.drugClass = 'DrugBank drug'
         MERGE (m:Medication {id: $id}) ON CREATE SET m.name = d.name, m.kind = 'prescription', m.description = 'From DrugBank', m.source = 'drugbank'
         MERGE (m)-[:CONTAINS]->(i)
         WITH i
         // Same active moiety under salt/ester names, e.g. "Dabigatran" -> "Dabigatran etexilate".
         MATCH (v:Drug) WHERE toLower(v.name) = toLower($name) OR toLower(v.name) STARTS WITH toLower($name) + ' '
         MERGE (i)-[:SAME_AS]->(v)`,
        { name, id },
      );
      medicationId = id;
      this.cache.delete("medications");
    }
    const [row] = await this.read<{ m: Medication }>(
      `MATCH (m:Medication {id: $id}) RETURN ${MED_PROJECTION} AS m`,
      { id: medicationId },
    );
    return row?.m ?? null;
  }

  async searchMedications(query: string, limit = 8): Promise<Medication[]> {
    const rows = await this.read<{ m: Medication }>(
      `MATCH (m:Medication)
       OPTIONAL MATCH (m)-[:CONTAINS]->(i:ActiveIngredient)
       WITH m, toLower(m.name + ' ' + coalesce(m.brand, '') + ' ' + coalesce(m.description, '')) AS hay,
            collect(toLower(i.name)) AS ings, toLower($q) AS q
       WHERE hay CONTAINS q OR any(n IN ings WHERE n CONTAINS q)
       WITH m, CASE WHEN toLower(m.name) STARTS WITH q OR toLower(coalesce(m.brand, '')) STARTS WITH q THEN 0 ELSE 1 END AS rank
       ORDER BY rank, m.name LIMIT $limit
       RETURN ${MED_PROJECTION} AS m`,
      { q: query.trim(), limit: neo4j.int(limit) },
    );
    const curated = rows.map((r) => r.m);
    if (curated.length >= limit || query.trim().length < 3) return curated;
    // Fill the rest from the full DrugBank layer, so any of its drugs can be checked.
    const drugs = await this.read<{ name: string }>(
      `MATCH (d:Drug) WHERE toLower(d.name) CONTAINS toLower($q) AND NOT (d)<-[:SAME_AS]-(:ActiveIngredient)
       RETURN d.name AS name
       ORDER BY CASE WHEN toLower(d.name) STARTS WITH toLower($q) THEN 0 ELSE 1 END, size(d.name) LIMIT $limit`,
      { q: query.trim(), limit: neo4j.int(limit - curated.length) },
    );
    return [
      ...curated,
      ...drugs.map(({ name }): Medication => ({
        id: `${DRUGBANK_PREFIX}${name}`,
        name,
        kind: "prescription",
        description: "From DrugBank",
        source: "drugbank",
        ingredients: [{ id: `${DRUGBANK_PREFIX}${name}`, name }],
      })),
    ];
  }

  private drugNames?: Promise<{ name: string; re: RegExp }[]>;

  async findDrugNames(text: string): Promise<string[]> {
    this.drugNames ??= this.read<{ name: string }>(`MATCH (d:Drug) WHERE size(d.name) >= 5 RETURN d.name AS name`).then((rows) =>
      rows
        .map(({ name }) => ({ name, re: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") }))
        .sort((a, b) => b.name.length - a.name.length),
    );
    const names = await this.drugNames;
    return names.filter((n) => n.re.test(text)).map((n) => n.name);
  }

  async listConditions() {
    return this.cached("conditions", () =>
      this.read<{ id: string; name: string; icd10?: string }>(`MATCH (c:Condition) RETURN c.id AS id, c.name AS name, c.icd10 AS icd10 ORDER BY name`),
    );
  }

  async createPatient(input: PatientInput): Promise<string> {
    const id = newPatientId(input.name);
    await this.write(
      `CREATE (p:Patient {id: $id, name: $name, age: $age, sex: $sex, relation: $relation, createdAt: datetime()})`,
      { id, name: input.name, age: neo4j.int(input.age), sex: input.sex ?? null, relation: input.relation ?? null },
    );
    await this.updatePatient(id, { conditions: input.conditions, habits: input.habits });
    return id;
  }

  async updatePatient(patientId: string, input: Partial<PatientInput>) {
    const { conditions, habits, age, ...profile } = input;
    if (Object.keys(profile).length || age !== undefined)
      await this.write(`MATCH (p:Patient {id: $id}) SET p += $props`, {
        id: patientId,
        props: { ...profile, ...(age !== undefined ? { age: neo4j.int(age) } : {}) },
      });
    if (conditions)
      await this.write(
        `MATCH (p:Patient {id: $id})
         OPTIONAL MATCH (p)-[old:HAS_CONDITION]->() DELETE old
         WITH DISTINCT p UNWIND $conditions AS c
         MERGE (cond:Condition {id: c.id}) ON CREATE SET cond.name = c.name
         MERGE (p)-[:HAS_CONDITION]->(cond)`,
        { id: patientId, conditions: conditions.map((c) => ({ id: c.id ?? slugify(c.name), name: c.name })) },
      );
    if (conditions) this.cache.delete("conditions");
    if (habits)
      await this.write(
        `MATCH (p:Patient {id: $id})
         OPTIONAL MATCH (p)-[old:CONSUMES]->() DELETE old
         WITH DISTINCT p UNWIND $habits AS h
         MATCH (f:Food {id: h.foodId})
         MERGE (p)-[c:CONSUMES]->(f) SET c.frequency = h.frequency, c.slot = h.slot`,
        { id: patientId, habits: habits.map((h) => ({ ...h, slot: h.slot ?? null })) },
      );
  }

  async deletePatient(patientId: string) {
    await this.write(`MATCH (p:Patient {id: $id}) DETACH DELETE p`, { id: patientId });
  }

  async listMedications(): Promise<Medication[]> {
    return this.cached("medications", async () => {
      const rows = await this.read<{ m: Medication }>(`MATCH (m:Medication) RETURN ${MED_PROJECTION} AS m ORDER BY m.name`);
      return rows.map((r) => r.m);
    });
  }

  async listFoods() {
    return this.cached("foods", () => this.read<{ id: string; name: string }>(`MATCH (f:Food) RETURN f.id AS id, f.name AS name ORDER BY name`));
  }

  async searchFoods(query: string) {
    return this.read<{ id: string; name: string }>(
      `MATCH (f:Food) WHERE toLower(f.name) CONTAINS toLower($q) OR toLower($q) CONTAINS split(toLower(f.name), ' ')[0]
       RETURN f.id AS id, f.name AS name`,
      { q: query.trim() },
    );
  }

  async getKnowledge(ingredientIds: string[], conditionIds: string[]): Promise<KnowledgeSlice> {
    const p = { ids: ingredientIds, conds: conditionIds };
    const [explicit, inferred, classRows, foodConflicts, depletions, contraindications, dbPairs, dbFood, foods] = await Promise.all([
      this.read<InteractionEdge>(
        `MATCH (a:ActiveIngredient)-[r:INTERACTS_WITH]-(b:ActiveIngredient)
         WHERE a.id IN $ids AND b.id IN $ids AND a.id < b.id
         RETURN a${ING} AS a, b${ING} AS b, r.severity AS severity, r.effect AS effect,
                r.mechanism AS mechanism, r.recommendation AS recommendation, r.separateHours AS separateHours`,
        p,
      ),
      // Ontology inference: walk each ingredient up its ATC class hierarchy and apply
      // class-level rules, skipping pairs that already have an explicit edge.
      this.read<InteractionEdge>(
        `MATCH (a:ActiveIngredient)-[:IN_CLASS]->(:DrugClass)-[:SUBCLASS_OF*0..]->(ca:DrugClass)
               -[r:CLASS_INTERACTS_WITH]-(cb:DrugClass)<-[:SUBCLASS_OF*0..]-(:DrugClass)<-[:IN_CLASS]-(b:ActiveIngredient)
         WHERE a.id IN $ids AND b.id IN $ids AND a.id < b.id AND NOT (a)-[:INTERACTS_WITH]-(b)
         WITH a, b, ca, cb, r ORDER BY ca.level + cb.level DESC
         WITH a, b, head(collect({ca: ca{.id, .name}, cb: cb{.id, .name}, r: r{.severity, .effect, .recommendation}})) AS best
         RETURN a${ING} AS a, b${ING} AS b, best.r.severity AS severity, best.r.effect AS effect,
                best.r.recommendation AS recommendation, {a: best.ca, b: best.cb} AS inferredVia`,
        p,
      ),
      this.read<{ id: string; classes: (DrugClassRef & { level: number })[] }>(
        `MATCH (i:ActiveIngredient)-[:IN_CLASS]->(c0:DrugClass) WHERE i.id IN $ids
         MATCH (c0)-[:SUBCLASS_OF*0..]->(c:DrugClass)
         WITH i, c ORDER BY c.level DESC
         RETURN i.id AS id, collect(c{.id, .name, .level}) AS classes`,
        p,
      ),
      this.read<KnowledgeSlice["foodConflicts"][number]>(
        `MATCH (i:ActiveIngredient)-[r:CONFLICTS_WITH]->(f:Food) WHERE i.id IN $ids
         RETURN i${ING} AS ingredient, f{.id, .name} AS food, r.severity AS severity, r.effect AS effect,
                r.recommendation AS recommendation, r.separateHours AS separateHours`,
        p,
      ),
      this.read<KnowledgeSlice["depletions"][number]>(
        `MATCH (i:ActiveIngredient)-[r:DEPLETES]->(n:Nutrient) WHERE i.id IN $ids
         RETURN i${ING} AS ingredient, n{.id, .name} AS nutrient, r.effect AS effect, r.recommendation AS recommendation`,
        p,
      ),
      this.read<KnowledgeSlice["contraindications"][number]>(
        `MATCH (i:ActiveIngredient)-[r:CONTRAINDICATED_IN]->(c:Condition) WHERE i.id IN $ids AND c.id IN $conds
         RETURN i${ING} AS ingredient, c{.id, .name} AS condition, r.severity AS severity, r.effect AS effect,
                r.recommendation AS recommendation`,
        p,
      ),
      // The teammate's DrugBank import, reached through (:ActiveIngredient)-[:SAME_AS]->(:Drug).
      this.read<DrugBankRows["pairs"][number]>(
        `MATCH (a:ActiveIngredient)-[:SAME_AS]->(:Drug)-[r:INTERACTS_WITH_DRUG]-(:Drug)<-[:SAME_AS]-(b:ActiveIngredient)
         WHERE a.id IN $ids AND b.id IN $ids AND a.id < b.id
         RETURN a${ING} AS a, b${ING} AS b, head(collect(r.description)) AS description`,
        p,
      ),
      this.read<DrugBankRows["food"][number]>(
        `MATCH (i:ActiveIngredient)-[:SAME_AS]->(:Drug)-[:HAS_FOOD_INTERACTION]->(f:FoodInteraction)
         WHERE i.id IN $ids
         RETURN i${ING} AS ingredient, collect(f.description) AS advice`,
        p,
      ),
      this.read<{ id: string; name: string }>(`MATCH (f:Food) RETURN f.id AS id, f.name AS name`),
    ]);

    const classOf: Record<string, DrugClassRef[]> = {};
    for (const row of classRows) classOf[row.id] = row.classes.map(({ id, name }) => ({ id, name }));

    const curated: KnowledgeSlice = {
      interactions: [...explicit, ...inferred].map(stripNulls),
      classOf,
      foodConflicts: foodConflicts.map(stripNulls),
      depletions,
      contraindications,
      labelAdvice: [],
    };
    return mergeDrugBank(curated, { pairs: dbPairs, food: dbFood }, new Map(foods.map((f) => [f.id, f])));
  }

  async addToRegimen(patientId: string, input: RegimenInput) {
    await this.write(
      `MATCH (p:Patient {id: $patientId}), (m:Medication {id: $medicationId})
       MERGE (p)-[t:TAKES]->(m)
       SET t.dose = $dose, t.slots = $slots, t.prescriber = $prescriber, t.purpose = $purpose, t.since = date()`,
      { patientId, prescriber: null, purpose: null, ...input },
    );
  }

  async removeFromRegimen(patientId: string, medicationId: string) {
    await this.write(
      `MATCH (:Patient {id: $patientId})-[t:TAKES]->(:Medication {id: $medicationId}) DELETE t`,
      { patientId, medicationId },
    );
  }
}

function stripNulls<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as T;
}

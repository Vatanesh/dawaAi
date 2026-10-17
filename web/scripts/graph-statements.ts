// Builds the Cypher that loads seed-data.ts into Neo4j. Shared by seed-neo4j.ts (runs it
// with parameters) and export-cypher.ts (inlines the parameters into neo4j/seed.cypher).

import { seed } from "../src/lib/graph/seed-data";

export interface Statement {
  cypher: string;
  rows?: Record<string, unknown>[];
}

const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const LABELS = ["Patient", "Medication", "ActiveIngredient", "DrugClass", "Food", "Nutrient", "Condition"];

export function statements(): Statement[] {
  return [
    ...LABELS.map((l) => ({
      cypher: `CREATE CONSTRAINT ${l.toLowerCase()}_id IF NOT EXISTS FOR (n:${l}) REQUIRE n.id IS UNIQUE`,
    })),

    // Ontology: WHO ATC classification as a class hierarchy.
    {
      cypher: `UNWIND $rows AS r MERGE (c:DrugClass {id: r.id}) SET c.name = r.name, c.level = r.level, c.system = 'ATC'`,
      rows: seed.drugClasses.map(({ id, name, level }) => ({ id, name, level })),
    },
    {
      cypher: `UNWIND $rows AS r MATCH (c:DrugClass {id: r.id}), (p:DrugClass {id: r.parent}) MERGE (c)-[:SUBCLASS_OF]->(p)`,
      rows: seed.drugClasses.filter((c) => c.parent).map(({ id, parent }) => ({ id, parent })),
    },
    {
      // An ingredient belongs to exactly one ATC class, so a changed code replaces the old edge.
      cypher: `UNWIND $rows AS r MERGE (i:ActiveIngredient {id: r.id}) SET i.name = r.name, i.drugClass = r.drugClass, i.atc = r.atc
               WITH i, r OPTIONAL MATCH (i)-[old:IN_CLASS]->(oc:DrugClass) WHERE oc.id <> substring(r.atc, 0, 5) DELETE old
               WITH DISTINCT i, r MATCH (c:DrugClass {id: substring(r.atc, 0, 5)}) MERGE (i)-[:IN_CLASS]->(c)`,
      rows: seed.ingredients,
    },
    {
      cypher: `UNWIND $rows AS r MERGE (m:Medication {id: r.id})
               SET m.name = r.name, m.brand = r.brand, m.kind = r.kind, m.description = r.description`,
      rows: seed.medications.map((m) => ({ id: m.id, name: m.name, brand: m.brand ?? null, kind: m.kind, description: m.description })),
    },
    {
      cypher: `UNWIND $rows AS r MATCH (m:Medication {id: r.medication}), (i:ActiveIngredient {id: r.ingredient})
               MERGE (m)-[k:CONTAINS]->(i) SET k.strength = r.strength`,
      rows: seed.medications.flatMap((m) => m.contains.map(([ingredient, strength]) => ({ medication: m.id, ingredient, strength }))),
    },
    { cypher: `UNWIND $rows AS r MERGE (f:Food {id: r.id}) SET f.name = r.name`, rows: seed.foods },
    { cypher: `UNWIND $rows AS r MERGE (n:Nutrient {id: r.id}) SET n.name = r.name`, rows: seed.nutrients },
    { cypher: `UNWIND $rows AS r MERGE (c:Condition {id: r.id}) SET c.name = r.name, c.icd10 = r.icd10`, rows: seed.conditions },

    // Knowledge edges.
    {
      cypher: `UNWIND $rows AS r MATCH (a:ActiveIngredient {id: r.a}), (b:ActiveIngredient {id: r.b})
               MERGE (a)-[e:INTERACTS_WITH]->(b) SET e += r.props`,
      rows: seed.interactions.map(({ a, b, ...props }) => ({ a, b, props: clean(props) })),
    },
    {
      cypher: `UNWIND $rows AS r MATCH (a:DrugClass {id: r.a}), (b:DrugClass {id: r.b})
               MERGE (a)-[e:CLASS_INTERACTS_WITH]->(b) SET e += r.props`,
      rows: seed.classInteractions.map(({ a, b, ...props }) => ({ a, b, props })),
    },
    {
      cypher: `UNWIND $rows AS r MATCH (i:ActiveIngredient {id: r.ingredient}), (f:Food {id: r.food})
               MERGE (i)-[e:CONFLICTS_WITH]->(f) SET e += r.props`,
      rows: seed.foodConflicts.map(({ ingredient, food, ...props }) => ({ ingredient, food, props: clean(props) })),
    },
    {
      cypher: `UNWIND $rows AS r MATCH (i:ActiveIngredient {id: r.ingredient}), (n:Nutrient {id: r.nutrient})
               MERGE (i)-[e:DEPLETES]->(n) SET e += r.props`,
      rows: seed.depletions.map(({ ingredient, nutrient, ...props }) => ({ ingredient, nutrient, props })),
    },
    {
      cypher: `UNWIND $rows AS r MATCH (i:ActiveIngredient {id: r.ingredient}), (c:Condition {id: r.condition})
               MERGE (i)-[e:CONTRAINDICATED_IN]->(c) SET e += r.props`,
      rows: seed.contraindications.map(({ ingredient, condition, ...props }) => ({ ingredient, condition, props })),
    },

    // Bridge to the teammate's DrugBank import. MATCH (not MERGE) so their Drug nodes are never created or changed here.
    {
      // Also matches salt/ester forms DrugBank lists separately, e.g. "Dabigatran etexilate".
      cypher: `UNWIND $rows AS r MATCH (i:ActiveIngredient {id: r.id}), (d:Drug)
               WHERE toLower(d.name) = toLower(r.drugbank) OR toLower(d.name) STARTS WITH toLower(r.drugbank) + ' '
                  OR toLower(d.name) = toLower(i.name)
               MERGE (i)-[:SAME_AS]->(d)`,
      rows: seed.ingredients.filter((i) => i.drugbank).map(({ id, drugbank }) => ({ id, drugbank })),
    },

    // Demo patients.
    {
      cypher: `UNWIND $rows AS r MERGE (p:Patient {id: r.id}) SET p.name = r.name, p.age = r.age, p.sex = r.sex, p.relation = r.relation`,
      rows: seed.patients.map(({ id, name, age, sex, relation }) => ({ id, name, age, sex, relation })),
    },
    {
      cypher: `UNWIND $rows AS r MATCH (p:Patient {id: r.patient}), (c:Condition {id: r.condition}) MERGE (p)-[:HAS_CONDITION]->(c)`,
      rows: seed.patients.flatMap((p) => p.conditions.map((condition) => ({ patient: p.id, condition }))),
    },
    {
      cypher: `UNWIND $rows AS r MATCH (p:Patient {id: r.patient}), (m:Medication {id: r.medication})
               MERGE (p)-[t:TAKES]->(m)
               SET t.dose = r.dose, t.slots = r.slots, t.prescriber = r.prescriber, t.purpose = r.purpose, t.since = date(r.since)`,
      rows: seed.patients.flatMap((p) => p.takes.map((t) => ({ patient: p.id, ...t }))),
    },
    {
      cypher: `UNWIND $rows AS r MATCH (p:Patient {id: r.patient}), (f:Food {id: r.food})
               MERGE (p)-[c:CONSUMES]->(f) SET c.frequency = r.frequency, c.slot = r.slot`,
      rows: seed.patients.flatMap((p) => p.consumes.map((c) => ({ patient: p.id, ...c, slot: c.slot ?? null }))),
    },
  ];
}

/** Cypher literal for a JS value (for the exported .cypher file). */
export function literal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(v)) return `[${v.map(literal).join(", ")}]`;
  return `{${Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `\`${k}\``}: ${literal(x)}`)
    .join(", ")}}`;
}

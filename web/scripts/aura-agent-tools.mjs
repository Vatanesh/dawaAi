// The Cypher templates used by the (free, internal) Aura Agent described in neo4j/aura-agent.md.
// Kept here so they can be tested against the real database:  npm run test:aura-agent
import neo4j from "neo4j-driver";

export const TOOLS = {
  get_patient_overview: {
    params: { patientName: "Ramesh" },
    cypher: `
MATCH (p:Patient) WHERE toLower(p.name) CONTAINS toLower($patientName) OR toLower(p.relation) = toLower($patientName)
OPTIONAL MATCH (p)-[t:TAKES]->(m:Medication)
WITH p, collect(m.name + coalesce(' (' + m.brand + ')', '') + ': ' + t.dose + ', ' + apoc.text.join(t.slots, '/') + ', prescribed by ' + t.prescriber) AS medicines
RETURN p.name AS patient, p.age AS age, medicines,
       [(p)-[:HAS_CONDITION]->(c:Condition) | c.name + ' (ICD-10 ' + c.icd10 + ')'] AS conditions,
       [(p)-[h:CONSUMES]->(f:Food) | f.name + ': ' + h.frequency] AS habits`,
  },
  check_new_medicine: {
    params: { patientName: "Ramesh", medicine: "warfarin" },
    cypher: `
MATCH (p:Patient) WHERE toLower(p.name) CONTAINS toLower($patientName) OR toLower(p.relation) = toLower($patientName)
MATCH (new:Medication) WHERE toLower(new.name) CONTAINS toLower($medicine) OR toLower(coalesce(new.brand, '')) CONTAINS toLower($medicine)
WITH p, new LIMIT 1
MATCH (new)-[:CONTAINS]->(ni:ActiveIngredient)
MATCH (p)-[:TAKES]->(m:Medication)-[:CONTAINS]->(mi:ActiveIngredient)
OPTIONAL MATCH (ni)-[x:INTERACTS_WITH]-(mi)
OPTIONAL MATCH (ni)-[:IN_CLASS]->(:DrugClass)-[:SUBCLASS_OF*0..]->(ca:DrugClass)-[cx:CLASS_INTERACTS_WITH]-(cb:DrugClass)<-[:SUBCLASS_OF*0..]-(:DrugClass)<-[:IN_CLASS]-(mi)
OPTIONAL MATCH (ni)-[:SAME_AS]->(:Drug)-[db:INTERACTS_WITH_DRUG]-(:Drug)<-[:SAME_AS]-(mi)
WITH new, m, mi, x, cx, ca, cb, head(collect(db.description)) AS drugbank
WHERE x IS NOT NULL OR cx IS NOT NULL OR drugbank IS NOT NULL
RETURN new.name AS newMedicine, m.name AS currentMedicine, mi.name AS ingredient,
       coalesce(x.severity, cx.severity, 'unrated (DrugBank)') AS severity,
       coalesce(x.effect, cx.effect, drugbank) AS effect,
       coalesce(x.recommendation, cx.recommendation, 'Ask the pharmacist.') AS whatToDo,
       CASE WHEN x IS NOT NULL THEN 'curated' WHEN cx IS NOT NULL THEN 'drug-class rule ' + ca.id + ' x ' + cb.id ELSE 'DrugBank' END AS source
ORDER BY CASE severity WHEN 'major' THEN 0 WHEN 'moderate' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END`,
  },
  check_food: {
    params: { patientName: "Ramesh", food: "grapefruit" },
    cypher: `
MATCH (p:Patient) WHERE toLower(p.name) CONTAINS toLower($patientName) OR toLower(p.relation) = toLower($patientName)
MATCH (p)-[:TAKES]->(m:Medication)-[:CONTAINS]->(i:ActiveIngredient)
OPTIONAL MATCH (i)-[c:CONFLICTS_WITH]->(f:Food) WHERE toLower(f.name) CONTAINS toLower($food)
OPTIONAL MATCH (i)-[:SAME_AS]->(:Drug)-[:HAS_FOOD_INTERACTION]->(fi:FoodInteraction) WHERE toLower(fi.description) CONTAINS toLower($food)
WITH m, i, c, f, collect(fi.description) AS drugbank
WHERE c IS NOT NULL OR size(drugbank) > 0
RETURN m.name AS medicine, i.name AS ingredient, c.severity AS severity, c.effect AS effect,
       c.recommendation AS whatToDo, drugbank AS drugbankAdvice`,
  },
  search_drugbank_warnings: {
    params: { text: "bleeding warfarin" },
    cypher: `
CALL db.index.fulltext.queryRelationships('drugWarningSearch', $text) YIELD relationship AS r, score
MATCH (a:Drug)-[r]->(b:Drug)
RETURN a.name AS drug1, b.name AS drug2, r.description AS description, score
ORDER BY score DESC LIMIT 15`,
  },
};

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD));
  try {
    for (const [name, t] of Object.entries(TOOLS)) {
      const { records } = await driver.executeQuery(t.cypher, t.params, { database: process.env.NEO4J_DATABASE, routing: neo4j.routing.READ });
      console.log(`\n${name}: ${records.length} rows`);
      for (const r of records.slice(0, 3)) console.log("  ", JSON.stringify(r.toObject()).slice(0, 260));
    }
  } finally {
    await driver.close();
  }
}

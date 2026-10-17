// Loads the demo knowledge graph (ontology, medicines, interactions, demo patients) into Neo4j.
// Idempotent: everything is MERGEd, so it is safe to re-run. It never deletes anything.
//   npm run seed:neo4j            (reads NEO4J_* from .env.local)

import neo4j from "neo4j-driver";
import { statements } from "./graph-statements";

const uri = process.env.NEO4J_URI;
if (!uri) {
  console.error("NEO4J_URI is not set. Add NEO4J_URI, NEO4J_USERNAME and NEO4J_PASSWORD to web/.env.local");
  process.exit(1);
}

const driver = neo4j.driver(uri, neo4j.auth.basic(process.env.NEO4J_USERNAME ?? "neo4j", process.env.NEO4J_PASSWORD ?? ""));
const database = process.env.NEO4J_DATABASE ?? "neo4j";

try {
  await driver.verifyConnectivity();
  for (const s of statements()) {
    const { summary } = await driver.executeQuery(s.cypher, { rows: s.rows ?? [] }, { database });
    const c = summary.counters.updates();
    console.log(`${s.cypher.split("\n")[0].slice(0, 70).padEnd(72)} +${c.nodesCreated} nodes +${c.relationshipsCreated} rels`);
  }
  const { records } = await driver.executeQuery(
    "MATCH (n) WHERE n:Patient OR n:Medication OR n:ActiveIngredient OR n:DrugClass OR n:Food OR n:Nutrient OR n:Condition RETURN labels(n)[0] AS label, count(*) AS n ORDER BY label",
    {},
    { database },
  );
  console.log("\nGraph now holds:", records.map((r) => `${r.get("label")} ${r.get("n")}`).join(", "));
} finally {
  await driver.close();
}

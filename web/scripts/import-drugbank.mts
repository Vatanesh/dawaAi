// Imports the teammate's DrugBank CSVs into Neo4j over the driver, so it works on Aura
// (where LOAD CSV can't read local files). Same schema and MERGE logic as neo4j/drugbank-import.cypher:
//   (:Drug {name})-[:INTERACTS_WITH_DRUG {description}]->(:Drug)
//   (:Drug)-[:HAS_FOOD_INTERACTION]->(:FoodInteraction {description, reference})
//
//   npm run import:drugbank -- <drug_to_drug.csv> <drug_to_food.csv>
// Defaults to ~/Downloads/db_drug_interactions.csv and ~/Downloads/cleaned_drug_food_interactions.csv.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import neo4j from "neo4j-driver";

const [ddiPath = join(homedir(), "Downloads", "db_drug_interactions.csv"), foodPath = join(homedir(), "Downloads", "cleaned_drug_food_interactions.csv")] =
  process.argv.slice(2);

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, commas and newlines inside quotes). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  const keys = header.map((h) => h.replace(/^﻿/, "").trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const uri = process.env.NEO4J_URI;
if (!uri) {
  console.error("NEO4J_URI is not set (web/.env.local).");
  process.exit(1);
}
const driver = neo4j.driver(uri, neo4j.auth.basic(process.env.NEO4J_USERNAME ?? "neo4j", process.env.NEO4J_PASSWORD ?? ""));
const database = process.env.NEO4J_DATABASE ?? "neo4j";
const run = (cypher: string, params: Record<string, unknown> = {}) => driver.executeQuery(cypher, params, { database });

async function batched(label: string, rows: Record<string, string>[], size: number, cypher: string) {
  const started = Date.now();
  for (let i = 0; i < rows.length; i += size) {
    await run(cypher, { rows: rows.slice(i, i + size) });
    process.stdout.write(`\r${label}: ${Math.min(i + size, rows.length)}/${rows.length}`);
  }
  console.log(` (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

try {
  await driver.verifyConnectivity();
  // 1. Indexes, as specified by the teammate (made idempotent).
  await run("CREATE CONSTRAINT drug_name IF NOT EXISTS FOR (d:Drug) REQUIRE d.name IS UNIQUE");
  await run("CREATE INDEX food_interaction_description IF NOT EXISTS FOR (f:FoodInteraction) ON (f.description)");
  await run("CREATE FULLTEXT INDEX foodWarningSearch IF NOT EXISTS FOR (f:FoodInteraction) ON EACH [f.description]");
  await run("CREATE FULLTEXT INDEX drugWarningSearch IF NOT EXISTS FOR ()-[r:INTERACTS_WITH_DRUG]-() ON EACH [r.description]");

  // 2. Drug-to-drug.
  const ddi = parseCsv(readFileSync(ddiPath, "utf8")).filter((r) => r["Drug 1"] && r["Drug 2"]);
  await batched(
    "Drug interactions",
    ddi,
    5000,
    `UNWIND $rows AS row
     MERGE (d1:Drug {name: row.\`Drug 1\`})
     MERGE (d2:Drug {name: row.\`Drug 2\`})
     MERGE (d1)-[r:INTERACTS_WITH_DRUG]->(d2)
     ON CREATE SET r.description = row.\`Interaction Description\``,
  );

  // 3. Drug-to-food.
  const food = parseCsv(readFileSync(foodPath, "utf8")).filter((r) => r.name && r.food_interactions);
  await batched(
    "Food interactions",
    food,
    1000,
    `UNWIND $rows AS row
     MERGE (d:Drug {name: row.name})
     MERGE (f:FoodInteraction {description: row.food_interactions})
     ON CREATE SET f.reference = row.reference
     MERGE (d)-[:HAS_FOOD_INTERACTION]->(f)`,
  );

  const { records } = await run(
    "MATCH (d:Drug) WITH count(d) AS drugs MATCH ()-[r:INTERACTS_WITH_DRUG]->() WITH drugs, count(r) AS ddi MATCH (f:FoodInteraction) RETURN drugs, ddi, count(f) AS food",
  );
  const r = records[0];
  console.log(`Done: ${r.get("drugs")} drugs, ${r.get("ddi")} drug interactions, ${r.get("food")} food interaction texts.`);
} finally {
  await driver.close();
}

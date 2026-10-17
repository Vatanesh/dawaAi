// Teammate's DrugBank import, made runnable. The schema is unchanged:
//   (:Drug {name})-[:INTERACTS_WITH_DRUG {description}]->(:Drug)
//   (:Drug)-[:HAS_FOOD_INTERACTION]->(:FoodInteraction {description, reference})
//
// Fixes versus the original snippet:
//   * CSV columns containing spaces need backticks: row.`Drug 1`, row.`Interaction Description`.
//   * IF NOT EXISTS so the script can be re-run.
//   * The 191k-row load runs in batches (CALL { } IN TRANSACTIONS) so it fits in Aura Free / small heaps.
//     In Neo4j Browser / Aura Query prefix each LOAD CSV with :auto. cypher-shell needs no prefix.
//   * Files are expected in the import folder as drug_to_drug.csv and drug_to_food.csv
//     (copies of db_drug_interactions.csv and cleaned_drug_food_interactions.csv).
//     On Aura, LOAD CSV needs an https URL instead of file:/// (e.g. a raw GitHub or Drive link).

CREATE CONSTRAINT drug_name IF NOT EXISTS FOR (d:Drug) REQUIRE d.name IS UNIQUE;
CREATE INDEX food_interaction_description IF NOT EXISTS FOR (f:FoodInteraction) ON (f.description);
CREATE FULLTEXT INDEX foodWarningSearch IF NOT EXISTS FOR (f:FoodInteraction) ON EACH [f.description];
CREATE FULLTEXT INDEX drugWarningSearch IF NOT EXISTS FOR ()-[r:INTERACTS_WITH_DRUG]-() ON EACH [r.description];

LOAD CSV WITH HEADERS FROM 'file:///drug_to_drug.csv' AS row
CALL {
  WITH row
  MERGE (d1:Drug {name: trim(row.`Drug 1`)})
  MERGE (d2:Drug {name: trim(row.`Drug 2`)})
  MERGE (d1)-[r:INTERACTS_WITH_DRUG]->(d2)
  ON CREATE SET r.description = trim(row.`Interaction Description`)
} IN TRANSACTIONS OF 5000 ROWS;

LOAD CSV WITH HEADERS FROM 'file:///drug_to_food.csv' AS row
CALL {
  WITH row
  MERGE (d:Drug {name: trim(row.name)})
  MERGE (f:FoodInteraction {description: trim(row.food_interactions)})
  ON CREATE SET f.reference = trim(row.reference)
  MERGE (d)-[:HAS_FOOD_INTERACTION]->(f)
} IN TRANSACTIONS OF 1000 ROWS;

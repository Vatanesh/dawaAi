import neo4j from "neo4j-driver";
const d = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD));
const db = { database: process.env.NEO4J_DATABASE };
try {
  await d.verifyConnectivity();
  const q = async (c) => (await d.executeQuery(c, {}, db)).records.map((r) => r.toObject());
  console.log("labels:", JSON.stringify(await q("MATCH (n) RETURN labels(n) AS l, count(*) AS n ORDER BY n DESC LIMIT 20")));
  console.log("rels:", JSON.stringify(await q("MATCH ()-[r]->() RETURN type(r) AS t, count(*) AS n ORDER BY n DESC LIMIT 20")));
  console.log("constraints:", JSON.stringify((await q("SHOW CONSTRAINTS YIELD name, labelsOrTypes, properties")).map((x) => `${x.name}:${x.labelsOrTypes}.${x.properties}`)));
  console.log("indexes:", JSON.stringify((await q("SHOW INDEXES YIELD name, type, labelsOrTypes")).map((x) => `${x.name}(${x.type}):${x.labelsOrTypes}`)));
  console.log("version:", JSON.stringify(await q("CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition")));
} finally { await d.close(); }

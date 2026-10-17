# Aura Agent setup (free, internal)

Aura Agent is free while it stays **internal**, which means it's used from the Aura console by project members. Making it external (REST or MCP endpoint) is billed per agent-hour. That's why the web app doesn't call it: the app answers for free from the same graph. Use this agent for demos and for exploring the data in the console.

Create it in the Aura console under **Agents → Create agent**, pick instance `1a6da03b`, and paste the sections below. Every template was tested against the live database (`npm run test:aura-agent` in `web/`).

## Name

DawaAI medication safety

## Description

Answers caregiver questions about medicine, food and supplement interactions for patients in the DawaAI graph.

## Instructions (system prompt)

```
You help family caregivers check medicines for older adults, using only the DawaAI knowledge graph.

The graph has two layers:
- Curated layer: (Patient)-[:TAKES]->(Medication)-[:CONTAINS]->(ActiveIngredient), with
  INTERACTS_WITH (ingredient to ingredient, graded major/moderate/minor), CONFLICTS_WITH (to Food),
  DEPLETES (to Nutrient), CONTRAINDICATED_IN (to Condition). Ingredients sit in the WHO ATC drug-class
  ontology: (ActiveIngredient)-[:IN_CLASS]->(DrugClass)-[:SUBCLASS_OF*]->(DrugClass), and some rules
  live at class level as CLASS_INTERACTS_WITH.
- DrugBank layer: (Drug)-[:INTERACTS_WITH_DRUG {description}]->(Drug) and
  (Drug)-[:HAS_FOOD_INTERACTION]->(FoodInteraction). It is linked to the curated layer by
  (ActiveIngredient)-[:SAME_AS]->(Drug). DrugBank has no severity grades.

Rules:
- Prefer the tools. Use Text2Cypher only when no tool fits.
- Every claim must come from a query result. If nothing is found, say "no known conflict in the graph", never "it's safe".
- Lead with the most serious finding. Say what to do in plain words.
- Never tell the caregiver to stop a prescribed medicine on their own. Point them to the prescriber or pharmacist.
- Patients can be named by name or by how the caregiver refers to them ("Dad", "Mum").
```

## Tools

### 1. Cypher template: `get_patient_overview`

Description: *Medicines (with dose, timing and prescriber), conditions and food habits for a patient. Use first for any question about a patient.*

Parameter: `patientName` (string): the patient's name or relation, e.g. "Ramesh" or "Dad".

```cypher
MATCH (p:Patient) WHERE toLower(p.name) CONTAINS toLower($patientName) OR toLower(p.relation) = toLower($patientName)
OPTIONAL MATCH (p)-[t:TAKES]->(m:Medication)
WITH p, collect(m.name + coalesce(' (' + m.brand + ')', '') + ': ' + t.dose + ', ' + apoc.text.join(t.slots, '/') + ', prescribed by ' + t.prescriber) AS medicines
RETURN p.name AS patient, p.age AS age, medicines,
       [(p)-[:HAS_CONDITION]->(c:Condition) | c.name + ' (ICD-10 ' + c.icd10 + ')'] AS conditions,
       [(p)-[h:CONSUMES]->(f:Food) | f.name + ': ' + h.frequency] AS habits
```

### 2. Cypher template: `check_new_medicine`

Description: *Checks a medicine the patient doesn't take yet against everything they do take: curated interactions, drug-class (ATC) rules and DrugBank.*

Parameters: `patientName` (string), `medicine` (string): generic or brand name, e.g. "warfarin" or "Eliquis".

```cypher
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
ORDER BY CASE severity WHEN 'major' THEN 0 WHEN 'moderate' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END
```

### 3. Cypher template: `check_food`

Description: *Whether a food or drink (grapefruit, alcohol, coffee, milk, leafy greens...) conflicts with the patient's current medicines.*

Parameters: `patientName` (string), `food` (string).

```cypher
MATCH (p:Patient) WHERE toLower(p.name) CONTAINS toLower($patientName) OR toLower(p.relation) = toLower($patientName)
MATCH (p)-[:TAKES]->(m:Medication)-[:CONTAINS]->(i:ActiveIngredient)
OPTIONAL MATCH (i)-[c:CONFLICTS_WITH]->(f:Food) WHERE toLower(f.name) CONTAINS toLower($food)
OPTIONAL MATCH (i)-[:SAME_AS]->(:Drug)-[:HAS_FOOD_INTERACTION]->(fi:FoodInteraction) WHERE toLower(fi.description) CONTAINS toLower($food)
WITH m, i, c, f, collect(fi.description) AS drugbank
WHERE c IS NOT NULL OR size(drugbank) > 0
RETURN m.name AS medicine, i.name AS ingredient, c.severity AS severity, c.effect AS effect,
       c.recommendation AS whatToDo, drugbank AS drugbankAdvice
```

### 4. Cypher template: `search_drugbank_warnings`

Description: *Full-text search over all 191k DrugBank interaction descriptions, e.g. "bleeding warfarin" or "serotonin". Use for drugs that aren't in the curated catalogue.*

Parameter: `text` (string).

```cypher
CALL db.index.fulltext.queryRelationships('drugWarningSearch', $text) YIELD relationship AS r, score
MATCH (a:Drug)-[r]->(b:Drug)
RETURN a.name AS drug1, b.name AS drug2, r.description AS description, score
ORDER BY score DESC LIMIT 15
```

### 5. Text2Cypher

Enable it with this description: *Any other question about the graph. Use the schema described in the instructions.*

## Try it

- "Dad was just prescribed a new blood thinner, warfarin. Does it conflict with his evening vitamins or his grapefruit juice?"
- "Is a glass of wine OK for Mum?"
- "What does DrugBank say about bleeding risk with apixaban?"

# Graph contract

The web app reads and writes Neo4j through `web/src/lib/graph/neo4j-repository.ts`. This is the schema it expects. Three layers live in one database; each owns its labels, so no layer overwrites another's.

## 1. DrugBank layer (teammate's import)

Loaded by `npm run import:drugbank` (Aura, over the driver) or `drugbank-import.cypher` (self-hosted, `LOAD CSV`).

```
(:Drug {name})                              unique on name
(:Drug)-[:INTERACTS_WITH_DRUG {description}]->(:Drug)        191k edges, no severity
(:Drug)-[:HAS_FOOD_INTERACTION]->(:FoodInteraction {description, reference})
Full-text indexes: drugWarningSearch (relationship description), foodWarningSearch (FoodInteraction description)
```

The app only reads this layer.

## 2. Curated layer and ontology (ours)

Loaded by `npm run seed:neo4j` or `seed.cypher`. Every node has a unique `id`.

```
(:Patient {id, name, age, sex, relation})
(:Patient)-[:TAKES {dose, slots: ['morning'|'midday'|'evening'|'bedtime'], prescriber, purpose, since: date}]->(:Medication)
(:Patient)-[:HAS_CONDITION]->(:Condition {id, name, icd10})
(:Patient)-[:CONSUMES {frequency, slot}]->(:Food {id, name})

(:Medication {id, name, brand, kind: 'prescription'|'otc'|'supplement', description, source?: 'drugbank'})
(:Medication)-[:CONTAINS {strength}]->(:ActiveIngredient {id, name, drugClass, atc})

(:ActiveIngredient)-[:INTERACTS_WITH {severity, effect, mechanism, recommendation, separateHours}]->(:ActiveIngredient)
(:ActiveIngredient)-[:CONFLICTS_WITH {severity, effect, recommendation, separateHours}]->(:Food)
(:ActiveIngredient)-[:DEPLETES {effect, recommendation}]->(:Nutrient {id, name})
(:ActiveIngredient)-[:CONTRAINDICATED_IN {severity, effect, recommendation}]->(:Condition)
```

`severity` is `major`, `moderate` or `minor`. `separateHours` means "safe if taken at least this many hours apart". The app turns it into timing checks against `TAKES.slots`.

### Ontology: WHO ATC classification

```
(:ActiveIngredient)-[:IN_CLASS]->(:DrugClass {id: ATC code, name, level 1-4, system: 'ATC'})
(:DrugClass)-[:SUBCLASS_OF]->(:DrugClass)              e.g. B01AA -> B01A -> B01 -> B
(:DrugClass)-[:CLASS_INTERACTS_WITH {severity, effect, recommendation}]->(:DrugClass)
```

Class-level rules apply to every ingredient under either class. For example, `M01A` (NSAIDs) × `B01A` (antithrombotics) flags any NSAID with any blood thinner, including drugs that have no hand-written edge. Explicit ingredient edges win over class rules. Two drugs in the same level-4 class are flagged as therapeutic duplication. Conditions carry ICD-10 codes.

### Bridge to DrugBank

```
(:ActiveIngredient)-[:SAME_AS]->(:Drug)        matched on the DrugBank name (e.g. aspirin -> 'Acetylsalicylic acid')
```

Created with `MATCH`, never `MERGE`, so the seed never creates or edits `Drug` nodes. The bridge also covers salt and ester forms that DrugBank lists separately (e.g. dabigatran → "Dabigatran etexilate", which holds its 401 interactions). 56 of the 59 curated ingredients are bridged.

When someone checks a DrugBank drug that isn't curated, the app creates a `Medication {id: 'db-<slug>', source: 'drugbank'}` and an `ActiveIngredient`, bridged with `SAME_AS`. Such drugs get DrugBank interactions but no ATC class rules. The app uses the bridge to add DrugBank pairs that the curated layer doesn't cover (marked "DrugBank", severity estimated and capped at moderate). It also attaches DrugBank text as corroboration on curated findings, and uses DrugBank food advice.

## 3. Agent memory layer (neo4j-agent-memory)

Written only by `memory-service/`. Labels include `Conversation`, `Message`, `Entity`, `Preference`, `ReasoningTrace`, `ReasoningStep`, `ToolCall` and `Ontology*`. Entity types come from the care ontology in `memory-service/ontology.py`: `CareRecipient`, `Caregiver`, `MentionedDrug`, `MentionedFood`, `MentionedCondition`, `Symptom`, `CareEvent`. They're named so they don't collide with the layers above. Memory entities are tied to the real graph with `(:Entity)-[:REFERS_TO]->(:Patient|:Medication|:Food|:Condition)`.

Sessions: `care:<patientId>` (care notes), `chat:<patientId>` (assistant conversation), `checks:<patientId>` (audit trail of every check).

## Budget on Aura Free

Aura Free allows 200k nodes and 400k relationships. As of setup there are about 3.4k nodes and 193k relationships, including the memory layer. Almost all of the relationships are DrugBank's, which leaves plenty of room for memory to grow.

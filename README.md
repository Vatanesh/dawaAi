# DawaAI: poly-pharmacy safety for caregivers and care teams

Older adults with chronic illness often take 5 to 10 medicines from several doctors, plus supplements and daily food habits, and nobody sees the whole list. DawaAI puts all of it in one Neo4j knowledge graph:

```
(Patient)-[:TAKES]->(Medication)-[:CONTAINS]->(ActiveIngredient)-[:INTERACTS_WITH]->(ActiveIngredient)
                                               (ActiveIngredient)-[:DEPLETES]->(Nutrient)
                                               (ActiveIngredient)-[:CONFLICTS_WITH]->(Food)
                                               (ActiveIngredient)-[:CONTRAINDICATED_IN]->(Condition)
                                               (ActiveIngredient)-[:IN_CLASS]->(DrugClass)  WHO ATC ontology
                                               (ActiveIngredient)-[:SAME_AS]->(Drug)        DrugBank, 2,146 drugs
```

It checks every cross-interaction, dietary conflict and dosing-time clash, and answers caregiver questions in plain language, such as "Dad was just prescribed a new blood thinner. Does it conflict with his evening vitamins or his grapefruit juice?", with the graph path behind every claim.

## Pages

| Route | What it is |
|---|---|
| `/` | Landing page: the problem, the graph pattern, live counts from Neo4j, how answers stay grounded, who it's for. |
| `/app` | The product. Care overview, then `/app?p=<person>` for one person. A guided tour starts on first visit. |
| `/report?p=<person>` | Printable one-page summary for a doctor or pharmacist, with provenance for every item. |

## What it does

| | |
|---|---|
| **Check before the first dose** | Search any of 56 curated medicines or all 2,146 DrugBank drugs (⌘K / Ctrl K). See what it would add before it's started, including timing if you pick when it's taken. |
| **Interactions** | Graded serious, moderate or minor across five checks: drug–drug, food and drink (against the person's real habits), health conditions (ICD-10), nutrient depletion, and duplicates (same ingredient or same drug class). |
| **Ontology inference** | WHO ATC class rules catch pairs nobody wrote an edge for: any NSAID with any blood thinner, two blood thinners, ACE inhibitor + ARB, benzodiazepines with opioids, fluoroquinolones with steroids or sulfonylureas, St John's wort with SSRIs. |
| **Dosage timing** | Spots absorption clashes (alendronate and calcium, levothyroxine and coffee). The timing assistant proposes a re-timed day and applies it in one click. Prescription times are never changed. |
| **Ask DawaAI** | Handles new medicines, vague classes ("a new blood thinner"), several medicines started together, alternatives ("losartan or ramipril?"), foods, symptoms ("why is Mum drowsy?"), timing, and "what to avoid with X". Answers the specific things asked about first. |
| **Agent memory** | Care notes, linked to the medicine and food nodes they mention, resurface when relevant (a recent fall when a blood thinner is considered). Chat history and an audit trail of every check (reasoning traces) live in Neo4j Agent Memory. |
| **Care-team overview** | Triage across everyone you look after, most urgent first: the B2B view for facilities and care teams. |
| **Doctor report** | One printable page with the medicine list, issues to discuss (each with its source and graph path), the timing plan and caregiver notes. |
| **White-label and mobile** | Rebrand with environment variables (name, colour, partner). Installable as a home-screen app (PWA). |

## How it stays grounded (no hallucination)

1. **The graph decides.** A deterministic engine (`web/src/lib/safety/engine.ts`) reads the person's medicines, habits and conditions from Neo4j and grades every interaction. No model decides what is true. Every finding carries the graph path that produced it, with relationship types: `Patient -[:TAKES]- Medication -[:CONTAINS]- Ingredient -[:INTERACTS_WITH]- …`.
2. **AI only rephrases.** With `NARA_API_KEY` set, NaraRouter rewrites the graph facts into plain language. `web/src/lib/assistant/grounding.ts` then checks the wording against the graph: a medicine, food, number or severity that the facts don't contain, or the word "safe", gets the text rejected and the graph's own answer shown instead. The answer shows which happened ("AI wording, checked against the graph" or "Graph answer"). Without a working key, answers are the graph's own text.
3. **Absence is never "safe".** When the graph has no edge, the app says "no known conflict in our graph".
4. **Estimates are labelled.** DrugBank has no severity grades; its findings are estimated from the wording, capped at moderate, and marked "DrugBank estimate" in answers, tallies and the printed report. DrugBank metabolism boilerplate with no named hazard is not shown.
5. **Every check is on record.** Questions and what-ifs are stored as reasoning traces (with the graph steps and tool calls) in Neo4j Agent Memory; see the Activity tab.

## Architecture

```
web/              Next.js 16 + shadcn/ui: UI, API routes, safety engine, timing optimiser, assistant
memory-service/   FastAPI + neo4j-agent-memory on the same Neo4j (bolt backend, care ontology)
neo4j/            Graph contract, seed.cypher, DrugBank import, Aura Agent setup
```

- **Knowledge layers** (live counts are on the landing page, from `/api/stats`):
  - **Curated layer (ours):** 59 ingredients, 56 medicines, 124 ATC classes, 95 interactions, 37 class rules, 39 food conflicts, 42 condition rules (incl. Beers criteria) and 17 depletions. Reviewed against FDA labels and interaction references; `npm run check:seed` verifies referential integrity.
  - **DrugBank layer (teammate's import):** 2,146 drugs, 191,252 interactions, 1,003 food-advice texts. Bridged with `(:ActiveIngredient)-[:SAME_AS]->(:Drug)` (56 of 59 curated ingredients, including salt forms such as "Dabigatran etexilate").
  - **Agent memory layer:** `neo4j-agent-memory` with a care ontology (`CareRecipient`, `MentionedDrug`, `Symptom`, `CareEvent`…), linked to graph nodes with `REFERS_TO`.
- **AI providers** (`web/src/lib/assistant/`): NaraRouter (OpenAI-compatible, free tier) or Claude (optional, paid); `AI_PROVIDER=graph` forces graph-only. A rejected or rate-limited key falls back to graph answers automatically, and the sidebar says so.
- **Schema:** `neo4j/CONTRACT.md`.

## Run it

Needs Node 20+ and Python 3.10+.

```bash
cd web
npm install
cp .env.example .env.local      # Neo4j + optional NARA_API_KEY; leave NEO4J_URI empty for the built-in demo graph
npm run dev                     # http://localhost:3000 (landing), http://localhost:3000/app (the app)

cd ../memory-service            # optional; without it memory is in-process and resets on restart
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 8100    # reads Neo4j credentials from web/.env.local
```

### Loading a fresh Neo4j database

```bash
cd web
npm run import:drugbank -- path/to/db_drug_interactions.csv path/to/cleaned_drug_food_interactions.csv
npm run seed:neo4j        # curated layer, ATC ontology, demo patients, SAME_AS bridge (idempotent, never deletes patients)
npm run check:seed        # integrity check of the curated data
npm run export:cypher     # regenerates neo4j/seed.cypher for Neo4j Browser
npm run test:aura-agent   # runs the Aura Agent Cypher templates
```

Restart `npm run dev` after changing the repository or assistant modules; the Neo4j driver is cached per process.

## Costs

| Piece | Cost |
|---|---|
| Neo4j Aura Free | free (about 3.5k nodes and 193k relationships used, out of 200k / 400k) |
| Memory service | free: local embedder, gazetteer extraction, no LLM |
| AI answers | NaraRouter free tier (7M tokens/day), or graph-only. Claude only if its key is set. |
| Aura Agent | free while internal (console only); see `neo4j/aura-agent.md` |

## Business model

**Families (premium consumer subscription).** A caregiver looking after a parent or partner checks any medicine before the first dose, keeps one day plan, asks questions in plain words, and hands the doctor a one-page report.

**Insurers, hospital networks and senior-care facilities (B2B, white-label).** The same app rebranded through configuration (`NEXT_PUBLIC_BRAND_*`; the landing page has a live preview), installable on phones, with a care-team overview that triages every resident by risk and an audit trail that documents each check. The goal for these buyers is fewer medication errors; no outcome numbers are claimed here because none have been measured yet.

## 90-second judge path

1. `/`: the problem, the graph pattern, live counts from Neo4j, how answers stay grounded.
2. **Open the demo** → `/app`: Mum needs attention (7 serious), Dad is on watch, Uncle Joe is stable. Open **Dad**.
3. Press **Ctrl K**, type "warfarin": the trial bar shows 1 serious, 4 moderate and 4 minor issues the new blood thinner would add, tagged "New".
4. Open the Advil finding: the graph path with relationship types, and "DrugBank agrees".
5. **Ask DawaAI**: "Dad was just prescribed a new blood thinner. Does it conflict with his evening vitamins or his grapefruit juice?" It answers those two points first across the four anticoagulants, then recalls his fall from the care notes. Expand "Checked the graph in N steps" to see the graph calls.
6. **Activity** tab: the same check stored as a reasoning trace. `/report?p=ramesh`: the printable summary with provenance.

## More to show

- Open **Mum**, then **Schedule**: the timing assistant moves Calcium + D3 to midday, clear of her alendronate, in one click.
- Press **Ctrl K** on Mum and type "klonopin": a second sedative is flagged serious with her tramadol and her fall risk.
- Ask Dad "Should he take losartan as well as his lisinopril?": ACE inhibitor + ARB is flagged serious through the ATC class rule.
- **Add a person**: their conditions (e.g. chronic kidney disease) immediately change what is flagged for a new medicine.

## Notes and limits

- The curated interactions summarise well-known, published interactions. This is decision support, not clinical advice.
- DrugBank severity is estimated from its wording and capped at moderate; estimates are labelled.
- The timing model uses four daily slots (8:00, 13:00, 18:00, 22:00).
- Three curated ingredients (St John's wort, vitamin K, iron) have no DrugBank entry and rely on curated rules only.

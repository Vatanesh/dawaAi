"""DawaAI memory service: neo4j-agent-memory over the same Neo4j as the medication graph.

Zero paid APIs:
  * embeddings come from a local hashing embedder (no model download, no API key),
  * entity extraction is a gazetteer built from the graph itself (Medication / Food / Condition
    names) plus care vocabulary, passed to the library as explicit mentions,
  * memory entities follow the care ontology in ontology.py and are linked to the real graph
    nodes with (:Entity)-[:REFERS_TO]->(...).

Three memory layers, all scoped per patient:
  * care notes      short-term messages in session  care:<patient_id>
  * chat history    short-term messages in session  chat:<patient_id>
  * audit trail     reasoning traces in session      checks:<patient_id>
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from neo4j import AsyncGraphDatabase
from neo4j_agent_memory import MemoryClient, MemorySettings, Neo4jConfig, ToolCallStatus
from neo4j_agent_memory.config.settings import (
    ExtractionConfig,
    ExtractorType,
    ResolutionConfig,
    ResolverStrategy,
    SchemaConfig,
)
from neo4j_agent_memory.schema.models import EntityRef
from pydantic import BaseModel, SecretStr

from ontology import (
    CARE_EVENT,
    CARE_ONTOLOGY,
    CARE_RECIPIENT,
    EVENT_TERMS,
    MENTIONED_CONDITION,
    MENTIONED_DRUG,
    MENTIONED_FOOD,
    SYMPTOM,
    SYMPTOM_TERMS,
)

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "web", ".env.local"))
load_dotenv()

NEO4J_URI = os.environ.get("NEO4J_URI", "")
NEO4J_USER = os.environ.get("NEO4J_USERNAME", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
NEO4J_DATABASE = os.environ.get("NEO4J_DATABASE", "neo4j")


class HashEmbedder:
    """Deterministic feature-hashing embedder: free, offline, good enough for keyword-ish recall.

    Implements the library's EmbeddingProvider protocol (model, dimensions, embed, embed_one).
    Swap for sentence-transformers later without touching anything else (dimensions must match
    the vector indexes, so drop them first: see README).
    """

    model = "hash-256"
    dimensions = 256

    def _vector(self, text: str) -> list[float]:
        tokens = re.findall(r"\w+", text.lower())
        features = tokens + [f"{a}_{b}" for a, b in zip(tokens, tokens[1:])]
        v = [0.0] * self.dimensions
        for feat in features:
            h = hashlib.blake2b(feat.encode(), digest_size=8).digest()
            v[int.from_bytes(h[:4], "little") % self.dimensions] += 1.0 if h[4] & 1 else -1.0
        norm = math.sqrt(sum(x * x for x in v))
        if not norm:
            v[0], norm = 1.0, 1.0
        return [x / norm for x in v]

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    async def embed_one(self, text: str) -> list[float]:
        return self._vector(text)


class Gazetteer:
    """Names of graph nodes, so notes can be linked to Medication / Food / Condition nodes."""

    TTL_SECONDS = 300

    def __init__(self) -> None:
        self.entries: list[tuple[re.Pattern[str], str, str, str, str]] = []  # pattern, canonical, type, label, id
        self.loaded_at = 0.0

    @staticmethod
    def _aliases(name: str, first_word: bool = True) -> set[str]:
        name = name.lower()
        base = re.sub(r"\s*\(.*?\)", "", name).strip()
        out = {base}
        for inner in re.findall(r"\((.*?)\)", name):
            out.update(p.strip() for p in re.split(r",|/", inner))
        out.update(p.strip() for p in re.split(r"\band\b|,", base))
        first = base.split()[0] if base.split() else ""
        if first_word and len(first) > 4:
            out.add(first)
        if "multivitamin" in base:
            out.update({"multivitamin", "vitamins"})
        return {a for a in out if len(a) > 2}

    async def refresh(self, driver) -> None:
        if time.time() - self.loaded_at < self.TTL_SECONDS and self.entries:
            return
        entries = []
        meds = await cypher(
            "MATCH (m:Medication) OPTIONAL MATCH (m)-[:CONTAINS]->(i:ActiveIngredient) "
            "RETURN m.id AS id, m.name AS name, m.brand AS brand, collect(i.name) AS ings"
        )
        foods = await cypher("MATCH (f:Food) RETURN f.id AS id, f.name AS name")
        conds = await cypher("MATCH (c:Condition) RETURN c.id AS id, c.name AS name")
        for m in meds:
            names = {m["name"], *(m["ings"] if len(m["ings"]) == 1 else [])} | ({m["brand"]} if m["brand"] else set())
            for alias in set().union(*(self._aliases(n, first_word=False) for n in names)):
                entries.append((alias, m["name"], MENTIONED_DRUG, "Medication", m["id"]))
        for f in foods:
            for alias in self._aliases(f["name"]):
                entries.append((alias, f["name"], MENTIONED_FOOD, "Food", f["id"]))
        for c in conds:
            for alias in self._aliases(c["name"]):
                entries.append((alias, c["name"], MENTIONED_CONDITION, "Condition", c["id"]))
        # Longest aliases first so "tylenol pm" wins over "tylenol".
        entries.sort(key=lambda e: -len(e[0]))
        self.entries = [(re.compile(rf"\b{re.escape(a)}\b"), canon, typ, label, nid) for a, canon, typ, label, nid in entries]
        self.loaded_at = time.time()

    def find(self, text: str) -> list[dict[str, str]]:
        lowered = text.lower()
        found: dict[tuple[str, str], dict[str, str]] = {}
        for pattern, canon, typ, label, nid in self.entries:
            if pattern.search(lowered):
                found.setdefault((typ, nid), {"name": canon, "type": typ, "label": label, "ref": nid})
                # Blank out the match so a shorter alias ("tylenol") can't re-match inside it ("tylenol pm").
                lowered = pattern.sub(lambda m: " " * len(m.group(0)), lowered)
        for term in SYMPTOM_TERMS:
            if re.search(rf"\b{re.escape(term)}\b", lowered):
                found.setdefault((SYMPTOM, term), {"name": term, "type": SYMPTOM})
        for term in EVENT_TERMS:
            if re.search(rf"\b{re.escape(term)}\b", lowered):
                found.setdefault((CARE_EVENT, term), {"name": term, "type": CARE_EVENT})
        return list(found.values())


state: dict[str, Any] = {}
gazetteer = Gazetteer()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not NEO4J_URI:
        raise RuntimeError("NEO4J_URI is not set. Put Neo4j credentials in web/.env.local or memory-service/.env")
    settings = MemorySettings(
        backend="bolt",
        neo4j=Neo4jConfig(uri=NEO4J_URI, username=NEO4J_USER, password=SecretStr(NEO4J_PASSWORD), database=NEO4J_DATABASE),
        embedding=HashEmbedder(),
        llm=None,
        extraction=ExtractionConfig(extractor_type=ExtractorType.NONE, enable_llm_fallback=False),
        resolution=ResolutionConfig(strategy=ResolverStrategy.EXACT),
        schema_config=SchemaConfig(use_active_ontology=False),
    )
    # Aura closes idle connections: check liveness and recycle connections before that happens.
    driver = AsyncGraphDatabase.driver(
        NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD), liveness_check_timeout=30, max_connection_lifetime=240, keep_alive=True
    )
    async with MemoryClient(settings, ontology=CARE_ONTOLOGY) as memory:
        state["memory"], state["driver"] = memory, driver
        yield
    await driver.close()


app = FastAPI(title="DawaAI memory service", lifespan=lifespan)


def mem() -> MemoryClient:
    return state["memory"]


async def cypher(query: str, **params: Any) -> list[dict[str, Any]]:
    # execute_query runs in a managed transaction, so dropped connections are retried transparently.
    records, _, _ = await state["driver"].execute_query(query, params, database_=NEO4J_DATABASE)
    return [r.data() for r in records]


async def patient_name(patient_id: str) -> str:
    rows = await cypher("MATCH (p:Patient {id: $id}) RETURN p.name AS name", id=patient_id)
    if not rows:
        raise HTTPException(404, f"Unknown patient {patient_id}")
    return rows[0]["name"]


async def store(session_id: str, patient_id: str, role: str, text: str, metadata: dict[str, Any]):
    """Add a message with gazetteer mentions, then tie mentioned entities to real graph nodes."""
    await gazetteer.refresh(state["driver"])
    name = await patient_name(patient_id)
    mentions = gazetteer.find(text)
    refs = [EntityRef(name=name, type=CARE_RECIPIENT)] + [EntityRef(name=m["name"], type=m["type"]) for m in mentions]
    message = await mem().short_term.add_message(
        session_id, role, text,
        extraction_mode="explicit", explicit_mentions=refs,
        metadata={**metadata, "patient_id": patient_id},
    )
    links = [{"name": name, "label": "Patient", "ref": patient_id}] + [m for m in mentions if "ref" in m]
    for link in links:
        await cypher(
            f"MATCH (e:Entity {{name: $name}}), (n:{link['label']} {{id: $ref}}) MERGE (e)-[:REFERS_TO]->(n)",
            name=link["name"], ref=link["ref"],
        )
    return message, mentions


# ── API models ───────────────────────────────────────────────────────────────

class NoteIn(BaseModel):
    patient_id: str
    text: str
    kind: Literal["observation", "event", "preference"] = "observation"
    author: str | None = None


class ChatIn(BaseModel):
    patient_id: str
    role: Literal["user", "assistant"]
    content: str


class ToolIn(BaseModel):
    name: str
    arguments: dict[str, Any] = {}
    result: Any | None = None


class StepIn(BaseModel):
    thought: str | None = None
    action: str | None = None
    observation: str | None = None
    tool: ToolIn | None = None


class TraceIn(BaseModel):
    patient_id: str
    task: str
    steps: list[StepIn]
    outcome: str | None = None
    success: bool = True


def note_out(m) -> dict[str, Any]:
    return {
        "id": str(m.id),
        "text": m.content,
        "role": str(getattr(m.role, "value", m.role)),
        "kind": m.metadata.get("kind", "observation"),
        "author": m.metadata.get("author"),
        "createdAt": m.created_at.isoformat(),
    }


async def mentions_for(message_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    rows = await cypher(
        """MATCH (m:Message)-[:MENTIONS]->(e:Entity) WHERE m.id IN $ids AND e.type <> $recipient
           OPTIONAL MATCH (e)-[:REFERS_TO]->(n)
           RETURN m.id AS id, collect(DISTINCT {name: e.name, type: e.type, ref: n.id}) AS mentions""",
        ids=message_ids, recipient=CARE_RECIPIENT,
    )
    return {r["id"]: r["mentions"] for r in rows}


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    await cypher("RETURN 1 AS ok")
    return {"ok": True, "embedder": HashEmbedder.model, "ontology": CARE_ONTOLOGY.domain.id}


@app.delete("/patients/{patient_id}")
async def forget_patient(patient_id: str):
    """Erase everything remembered about a patient: notes, chats, audit traces, the care-recipient entity."""
    sessions = [f"care:{patient_id}", f"chat:{patient_id}", f"checks:{patient_id}"]
    rows = await cypher(
        """MATCH (c:Conversation) WHERE c.session_id IN $sessions
           OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message)
           WITH collect(DISTINCT c) + collect(DISTINCT m) AS xs
           FOREACH (x IN xs | DETACH DELETE x) RETURN size(xs) AS n""",
        sessions=sessions,
    )
    traces = await cypher(
        """MATCH (t:ReasoningTrace) WHERE t.session_id IN $sessions
           OPTIONAL MATCH (t)-[*1..2]->(x) WHERE x:ReasoningStep OR x:ToolCall
           WITH collect(DISTINCT t) + collect(DISTINCT x) AS xs
           FOREACH (x IN xs | DETACH DELETE x) RETURN size(xs) AS n""",
        sessions=sessions,
    )
    entities = await cypher(
        """MATCH (e:Entity)-[:REFERS_TO]->(:Patient {id: $id}) WITH collect(e) AS es
           FOREACH (e IN es | DETACH DELETE e) RETURN size(es) AS n""",
        id=patient_id,
    )
    return {"messages": rows[0]["n"], "traces": traces[0]["n"], "entities": entities[0]["n"]}


@app.post("/notes")
async def add_note(note: NoteIn):
    message, mentions = await store(f"care:{note.patient_id}", note.patient_id, "user", note.text,
                                    {"kind": note.kind, "author": note.author})
    if note.kind == "preference":
        await mem().long_term.add_preference(
            category="care", preference=note.text, context=f"patient:{note.patient_id}",
            applies_to=[EntityRef(name=await patient_name(note.patient_id), type=CARE_RECIPIENT)],
        )
    return {**note_out(message), "mentions": mentions}


@app.get("/notes")
async def list_notes(patient_id: str, limit: int = 50):
    conv = await mem().short_term.get_conversation(f"care:{patient_id}", limit=limit)
    notes = [note_out(m) for m in conv.messages]
    by_id = await mentions_for([n["id"] for n in notes])
    return [{**n, "mentions": by_id.get(n["id"], [])} for n in reversed(notes)]


@app.post("/chat")
async def add_chat(msg: ChatIn):
    message, _ = await store(f"chat:{msg.patient_id}", msg.patient_id, msg.role, msg.content, {})
    return note_out(message)


@app.get("/chat")
async def chat_history(patient_id: str, limit: int = 20):
    # get_conversation returns the oldest messages first; the caller wants the most recent `limit`.
    conv = await mem().short_term.get_conversation(f"chat:{patient_id}", limit=500)
    msgs = sorted(conv.messages, key=lambda m: str(getattr(m, "created_at", None) or getattr(m, "timestamp", "")))
    return [note_out(m) for m in msgs[-limit:]]


@app.get("/recall")
async def recall(patient_id: str, query: str, limit: int = 5):
    """Care notes relevant to a question: semantic hits first, then the most recent notes."""
    session = f"care:{patient_id}"
    hits = await mem().short_term.search_messages(query, session_id=session, limit=limit * 3, threshold=0.15)
    conv = await mem().short_term.get_conversation(session, limit=50)
    # The vector search can return other sessions' messages; never let one patient's notes reach another.
    own = {str(m.id) for m in conv.messages}
    seen, out = set(), []
    for m in [*(h for h in hits if str(h.id) in own), *reversed(conv.messages)]:
        if str(m.id) not in seen:
            seen.add(str(m.id))
            out.append(note_out(m))
    out = out[:limit]
    by_id = await mentions_for([n["id"] for n in out])
    return [{**n, "mentions": by_id.get(n["id"], [])} for n in out]


@app.post("/traces")
async def add_trace(trace: TraceIn):
    reasoning = mem().reasoning
    t = await reasoning.start_trace(f"checks:{trace.patient_id}", trace.task, metadata={"patient_id": trace.patient_id})
    for s in trace.steps:
        step = await reasoning.add_step(t.id, thought=s.thought, action=s.action, observation=s.observation)
        if s.tool:
            await reasoning.record_tool_call(step.id, s.tool.name, s.tool.arguments, result=s.tool.result,
                                             status=ToolCallStatus.SUCCESS)
    await reasoning.complete_trace(t.id, outcome=trace.outcome, success=trace.success)
    return {"id": str(t.id)}


@app.get("/traces")
async def list_traces(patient_id: str, limit: int = 20):
    reasoning = mem().reasoning
    traces = await reasoning.list_traces(session_id=f"checks:{patient_id}", limit=limit)
    out = []
    for t in traces:
        full = await reasoning.get_trace_with_steps(t.id)
        out.append({
            "id": str(full.id),
            "task": full.task,
            "outcome": full.outcome,
            "success": full.success,
            "startedAt": full.started_at.isoformat(),
            "steps": [
                {
                    "thought": s.thought, "action": s.action, "observation": s.observation,
                    "tools": [{"name": c.tool_name, "arguments": c.arguments} for c in s.tool_calls],
                }
                for s in sorted(full.steps, key=lambda s: s.step_number)
            ],
        })
    return sorted(out, key=lambda t: t["startedAt"], reverse=True)

import { getRepository } from "../graph/repository";

// Memory for the caregiver assistant, backed by the neo4j-agent-memory sidecar (memory-service/).
// When MEMORY_SERVICE_URL isn't set, an in-process store with the same shape keeps the demo working.

export interface Mention {
  name: string;
  type: string;
  ref?: string | null;
}

export interface CareNote {
  id: string;
  text: string;
  kind: "observation" | "event" | "preference";
  author?: string | null;
  createdAt: string;
  mentions: Mention[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface TraceStep {
  thought?: string | null;
  action?: string | null;
  observation?: string | null;
  tools: { name: string; arguments: Record<string, unknown> }[];
}

export interface Trace {
  id: string;
  task: string;
  outcome?: string | null;
  success?: boolean | null;
  startedAt: string;
  steps: TraceStep[];
}

export interface TraceInput {
  patientId: string;
  task: string;
  outcome: string;
  success: boolean;
  steps: { thought?: string; action?: string; observation?: string; tool?: { name: string; arguments: Record<string, unknown> } }[];
}

export interface MemoryStore {
  readonly mode: "neo4j-agent-memory" | "neo4j-read" | "local";
  listNotes(patientId: string): Promise<CareNote[]>;
  addNote(patientId: string, note: Pick<CareNote, "text" | "kind"> & { author?: string }): Promise<CareNote>;
  recall(patientId: string, query: string, limit?: number): Promise<CareNote[]>;
  addChat(patientId: string, role: ChatMessage["role"], text: string): Promise<void>;
  chatHistory(patientId: string, limit?: number): Promise<ChatMessage[]>;
  addTrace(trace: TraceInput): Promise<void>;
  listTraces(patientId: string): Promise<Trace[]>;
  /** Erase everything remembered about a patient (used when the patient is deleted). */
  forget(patientId: string): Promise<void>;
}

class HttpMemoryStore implements MemoryStore {
  readonly mode = "neo4j-agent-memory" as const;
  constructor(private base: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Memory service ${path} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  listNotes(patientId: string) {
    return this.call<CareNote[]>(`/notes?patient_id=${encodeURIComponent(patientId)}`);
  }
  addNote(patientId: string, note: Pick<CareNote, "text" | "kind"> & { author?: string }) {
    return this.call<CareNote>("/notes", { method: "POST", body: JSON.stringify({ patient_id: patientId, ...note }) });
  }
  async recall(patientId: string, query: string, limit = 5) {
    const q = new URLSearchParams({ patient_id: patientId, query, limit: String(limit) });
    const notes = await this.call<CareNote[]>(`/recall?${q}`);
    return notes.map((n) => ({ ...n, mentions: n.mentions ?? [] }));
  }
  async addChat(patientId: string, role: ChatMessage["role"], text: string) {
    await this.call("/chat", { method: "POST", body: JSON.stringify({ patient_id: patientId, role, content: text }) });
  }
  async chatHistory(patientId: string, limit = 20) {
    const rows = await this.call<{ role: string; text: string; createdAt: string }[]>(
      `/chat?patient_id=${encodeURIComponent(patientId)}&limit=${limit}`,
    );
    return rows.map((r) => ({ role: r.role === "assistant" ? "assistant" : "user", text: r.text, createdAt: r.createdAt }) as ChatMessage);
  }
  async addTrace(trace: TraceInput) {
    await this.call("/traces", {
      method: "POST",
      body: JSON.stringify({
        patient_id: trace.patientId,
        task: trace.task,
        outcome: trace.outcome,
        success: trace.success,
        steps: trace.steps,
      }),
    });
  }
  listTraces(patientId: string) {
    return this.call<Trace[]>(`/traces?patient_id=${encodeURIComponent(patientId)}`);
  }
  async forget(patientId: string) {
    await this.call(`/patients/${encodeURIComponent(patientId)}`, { method: "DELETE" });
  }
}

const now = () => new Date().toISOString();

/** Keyword recall shared by the stores that have no vector index. */
function keywordRecall(notes: CareNote[], query: string, limit: number) {
  const words = new Set(query.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const score = (n: CareNote) => (n.text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => words.has(w)).length;
  return notes.map((n) => ({ n, s: score(n) })).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.n);
}

/**
 * In-process memory: starts empty (no made-up notes) and lasts for the server process. Used when
 * neither the sidecar nor Neo4j is configured.
 */
class LocalMemoryStore implements MemoryStore {
  readonly mode: MemoryStore["mode"] = "local";
  protected notes = new Map<string, CareNote[]>();
  protected chats = new Map<string, ChatMessage[]>();
  protected traces = new Map<string, Trace[]>();

  async listNotes(patientId: string) {
    return [...(this.notes.get(patientId) ?? [])].reverse();
  }
  async addNote(patientId: string, note: Pick<CareNote, "text" | "kind"> & { author?: string }) {
    const created: CareNote = { id: crypto.randomUUID(), createdAt: now(), mentions: [], ...note };
    this.notes.set(patientId, [...(this.notes.get(patientId) ?? []), created]);
    return created;
  }
  async recall(patientId: string, query: string, limit = 5) {
    return keywordRecall(await this.listNotes(patientId), query, limit);
  }
  async addChat(patientId: string, role: ChatMessage["role"], text: string) {
    this.chats.set(patientId, [...(this.chats.get(patientId) ?? []), { role, text, createdAt: now() }]);
  }
  async chatHistory(patientId: string, limit = 20) {
    return (this.chats.get(patientId) ?? []).slice(-limit);
  }
  async addTrace(t: TraceInput) {
    const trace: Trace = {
      id: crypto.randomUUID(),
      task: t.task,
      outcome: t.outcome,
      success: t.success,
      startedAt: now(),
      steps: t.steps.map((s) => ({ thought: s.thought, action: s.action, observation: s.observation, tools: s.tool ? [s.tool] : [] })),
    };
    this.traces.set(t.patientId, [trace, ...(this.traces.get(t.patientId) ?? [])]);
  }
  async listTraces(patientId: string) {
    return this.traces.get(patientId) ?? [];
  }
  async forget(patientId: string) {
    this.notes.delete(patientId);
    this.chats.delete(patientId);
    this.traces.delete(patientId);
  }
}

/**
 * Sidecar not reachable but Neo4j is: read the notes, chats and audit trail the sidecar stored
 * there, and keep anything written in this process locally on top. Nothing is written to the
 * sidecar's nodes from here.
 */
class Neo4jReadMemoryStore extends LocalMemoryStore {
  readonly mode = "neo4j-read" as const;
  private reads = async () => (await getRepository()).memoryReads!;

  async listNotes(patientId: string) {
    const stored = (await (await this.reads()).notes(patientId)).map((n) => ({ ...n, kind: n.kind as CareNote["kind"] }));
    return [...(await super.listNotes(patientId)), ...stored];
  }
  async chatHistory(patientId: string, limit = 20) {
    const stored = (await (await this.reads()).chat(patientId, limit)).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", text: m.text, createdAt: m.createdAt }) as ChatMessage);
    return [...stored, ...(await super.chatHistory(patientId, limit))].slice(-limit);
  }
  async listTraces(patientId: string) {
    const stored: Trace[] = (await (await this.reads()).traces(patientId, 30)).map((t) => ({
      ...t,
      steps: t.steps.map((s) => ({
        ...s,
        tools: s.tools.map((x) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(x.arguments);
          } catch {
            args = { raw: x.arguments };
          }
          return { name: x.name, arguments: args };
        }),
      })),
    }));
    return [...(await super.listTraces(patientId)), ...stored];
  }
}

const globalForMemory = globalThis as unknown as { __dawaMemory?: MemoryStore };

export function getMemory(): MemoryStore {
  globalForMemory.__dawaMemory ??= process.env.MEMORY_SERVICE_URL
    ? new HttpMemoryStore(process.env.MEMORY_SERVICE_URL.replace(/\/$/, ""))
    : process.env.NEO4J_URI
      ? new Neo4jReadMemoryStore()
      : new LocalMemoryStore();
  return globalForMemory.__dawaMemory;
}

/** Memory is helpful, never critical: a failing memory call must not break a safety check. */
export async function softly<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn("[memory]", err instanceof Error ? err.message : err);
    return fallback;
  }
}

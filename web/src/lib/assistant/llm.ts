// Language-model providers for the assistant. The graph always decides what is true; a model only
// (1) helps read a free-form question and (2) turns graph facts into a short, natural answer, and
// that wording is checked against the graph (grounding.ts) before anyone sees it.
//
// Providers are tried in a cascade, each key in turn, so a rate-limited or rejected key just
// hands over to the next one:
//   GEMINI_API_KEY, GEMINI_API_KEY_2 … (Gemini free tier, OpenAI-compatible endpoint)
//   NARA_API_KEY                        (NaraRouter, OpenAI-compatible gateway)
//   ANTHROPIC_API_KEY                   (Claude with graph tools; see claude.ts)
//   none                                (graph-only answers)
// AI_PROVIDER=router|claude|graph forces one.

export type Provider = "router" | "claude" | "graph";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface Key {
  id: string; // for logs and status, never the secret itself
  base: string;
  token: string;
  models: string[];
}

function keys(): Key[] {
  const out: Key[] = [];
  const geminiModels = (process.env.GEMINI_MODELS ?? "gemini-3.8-flash,gemini-3.5-flash-lite").split(",").map((m) => m.trim()).filter(Boolean);
  const gemini = [process.env.GEMINI_API_KEY, ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`])].filter((k): k is string => !!k);
  gemini.forEach((token, i) => out.push({ id: `gemini-${i + 1}`, base: "https://generativelanguage.googleapis.com/v1beta/openai", token, models: geminiModels }));
  if (process.env.NARA_API_KEY)
    out.push({
      id: "nararouter",
      base: (process.env.NARA_BASE_URL ?? "https://router.bynara.id/v1").replace(/\/$/, ""),
      token: process.env.NARA_API_KEY,
      models: (process.env.NARA_MODELS ?? "auto/bynara,agnes-2.5-flash,laguna-s-2.1").split(",").map((m) => m.trim()).filter(Boolean),
    });
  return out;
}

export function aiProvider(): Provider {
  const forced = process.env.AI_PROVIDER as Provider | undefined;
  if (forced === "graph") return "graph";
  if (forced === "router" && keys().length) return "router";
  if (forced === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (keys().length) return "router";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return "graph";
}

export class RouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
  ) {
    super(message);
  }
}

// Keys that failed recently are skipped: a rejected key for 10 minutes, a rate-limited one for a minute.
const blocked = new Map<string, { until: number; reason: string }>();
const usable = (k: Key) => !blocked.get(k.id) || blocked.get(k.id)!.until < Date.now();

/** Human-readable reason when no key is currently usable, else undefined. */
export function routerIssue(): string | undefined {
  const all = keys();
  if (!all.length) return undefined;
  if (all.some(usable)) return undefined;
  const reasons = [...new Set(all.map((k) => blocked.get(k.id)?.reason).filter(Boolean))];
  return reasons.join("; ") || "no usable AI key";
}

/** The model that would answer next, for the status line. */
export function routerModels(): string[] {
  const k = keys().find(usable) ?? keys()[0];
  return k ? k.models.map((m) => `${k.id.replace(/-\d+$/, "")}/${m}`) : [];
}

let lastKeyCheck = 0;
/** Verifies the keys cheaply (GET /models, no tokens spent), at most every 10 minutes. */
export async function checkRouterKey() {
  if (!keys().length || Date.now() - lastKeyCheck < 10 * 60_000) return;
  lastKeyCheck = Date.now();
  await Promise.all(
    keys().map(async (k) => {
      try {
        const res = await fetch(`${k.base}/models`, { headers: { authorization: `Bearer ${k.token}` }, signal: AbortSignal.timeout(4000) });
        if (res.status === 401 || res.status === 403) blocked.set(k.id, { until: Date.now() + 10 * 60_000, reason: `${k.id} rejected its API key` });
        else if (res.ok) blocked.delete(k.id);
      } catch {
        // Network trouble: leave the state as is; the next real call decides.
      }
    }),
  );
}

async function post(k: Key, model: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const res = await fetch(`${k.base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${k.token}` },
    body: JSON.stringify({ model, ...body }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new RouterError(err?.error?.message ?? `${k.id} ${res.status}`, res.status, err?.error?.type);
  }
  return res;
}

/** Try every usable key and each of its models until one accepts the request. */
async function withFallback(body: Record<string, unknown>, signal?: AbortSignal) {
  let last: unknown = new RouterError(routerIssue() ?? "no AI key configured", 503, "paused");
  for (const k of keys().filter(usable)) {
    for (const model of k.models) {
      try {
        const res = await post(k, model, body, signal);
        blocked.delete(k.id);
        return { res, model };
      } catch (err) {
        last = err;
        if (signal?.aborted) throw err;
        if (err instanceof RouterError && (err.status === 401 || err.status === 403)) {
          blocked.set(k.id, { until: Date.now() + 10 * 60_000, reason: `${k.id} rejected its API key` });
          break; // other models on this key will fail the same way
        }
        if (err instanceof RouterError && err.status === 429) {
          blocked.set(k.id, { until: Date.now() + 60_000, reason: `${k.id} rate limit reached` });
          break;
        }
        // 404 (model retired) or 5xx: try the next model, then the next key.
      }
    }
  }
  throw last;
}

/** Stream a completion as text deltas. */
export async function* routerStream(
  messages: ChatMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal; onFinish?: (reason: string | null) => void } = {},
) {
  // Thinking models spend part of max_tokens on reasoning, so the budget is generous and
  // reasoning is kept low; a cut-off answer is reported through onFinish("length").
  const { res } = await withFallback(
    { messages, stream: true, temperature: 0.2, max_tokens: opts.maxTokens ?? 2000, reasoning_effort: "low" },
    opts.signal,
  );
  let finish: string | null = null;
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.replace(/^data:\s?/, "").trim();
      if (!line.startsWith("data:") || !data || data === "[DONE]") continue;
      try {
        const choice = JSON.parse(data)?.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        // Ignore keep-alives and partial frames.
      }
    }
  }
  opts.onFinish?.(finish);
}

/** One non-streaming completion that must return JSON. Returns null when the model doesn't comply. */
export async function routerJSON<T>(messages: ChatMessage[], signal?: AbortSignal): Promise<T | null> {
  const { res } = await withFallback({ messages, temperature: 0, max_tokens: 1200, reasoning_effort: "low" }, signal);
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

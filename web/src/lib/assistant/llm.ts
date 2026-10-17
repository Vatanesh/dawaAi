// Language-model providers for the assistant. The graph always decides what is true; a model only
// (1) helps read a free-form question and (2) turns graph facts into a short, natural answer.
//
//   NARA_API_KEY       -> NaraRouter (router.bynara.id), OpenAI-compatible gateway with a free tier
//   ANTHROPIC_API_KEY  -> Claude with graph tools (see claude.ts)
//   neither            -> graph-only answers, no model at all
// AI_PROVIDER=router|claude|graph forces one.

export type Provider = "router" | "claude" | "graph";

export function aiProvider(): Provider {
  const forced = process.env.AI_PROVIDER as Provider | undefined;
  if (forced === "graph") return "graph";
  if (forced === "router" && process.env.NARA_API_KEY) return "router";
  if (forced === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.NARA_API_KEY) return "router";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return "graph";
}

const BASE = (process.env.NARA_BASE_URL ?? "https://router.bynara.id/v1").replace(/\/$/, "");
// Tried in order: a later model is used when an earlier one is unavailable on the plan or rate-limited.
const MODELS = (process.env.NARA_MODELS ?? "auto/bynara,agnes-2.5-flash,laguna-s-2.1").split(",").map((m) => m.trim()).filter(Boolean);

export const routerModels = () => MODELS;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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

async function post(model: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NARA_API_KEY}` },
    body: JSON.stringify({ model, ...body }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new RouterError(err?.error?.message ?? `NaraRouter ${res.status}`, res.status, err?.error?.type);
  }
  return res;
}

// A rejected key won't start working mid-session: remember it for a while instead of paying a
// failed round-trip on every question. Rate limits back off for a minute.
const health: { blockedUntil: number; reason?: string } = { blockedUntil: 0 };

export function routerIssue(): string | undefined {
  return Date.now() < health.blockedUntil ? health.reason : undefined;
}

let lastKeyCheck = 0;
/** Verifies the key with GET /models (no tokens spent), at most every 10 minutes. */
export async function checkRouterKey() {
  if (!process.env.NARA_API_KEY || Date.now() - lastKeyCheck < 10 * 60_000) return;
  lastKeyCheck = Date.now();
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: { authorization: `Bearer ${process.env.NARA_API_KEY}` },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 401 || res.status === 403) {
      health.blockedUntil = Date.now() + 10 * 60_000;
      health.reason = "NaraRouter rejected the API key";
    } else if (res.ok) health.blockedUntil = 0;
  } catch {
    // Network trouble: leave the state as is; the next real call decides.
  }
}

/** Try each configured model until one accepts the request. Auth errors stop immediately. */
async function withFallback(body: Record<string, unknown>, signal?: AbortSignal) {
  if (routerIssue()) throw new RouterError(health.reason!, 503, "paused");
  let last: unknown;
  for (const model of MODELS) {
    try {
      const res = await post(model, body, signal);
      health.blockedUntil = 0;
      return { res, model };
    } catch (err) {
      last = err;
      if (err instanceof RouterError && (err.status === 401 || err.status === 403)) {
        health.blockedUntil = Date.now() + 10 * 60_000;
        health.reason = "NaraRouter rejected the API key";
        throw err;
      }
      if (err instanceof RouterError && err.status === 429) {
        health.blockedUntil = Date.now() + 60_000;
        health.reason = "NaraRouter rate limit reached";
      }
    }
  }
  throw last;
}

/** Stream a completion as text deltas. */
export async function* routerStream(messages: ChatMessage[], opts: { maxTokens?: number; signal?: AbortSignal } = {}) {
  const { res } = await withFallback({ messages, stream: true, temperature: 0.2, max_tokens: opts.maxTokens ?? 600 }, opts.signal);
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
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        // Ignore keep-alives and partial frames.
      }
    }
  }
}

/** One non-streaming completion that must return JSON. Returns null when the model doesn't comply. */
export async function routerJSON<T>(messages: ChatMessage[], signal?: AbortSignal): Promise<T | null> {
  const { res } = await withFallback({ messages, temperature: 0, max_tokens: 300 }, signal);
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

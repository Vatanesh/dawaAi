// Guard against hallucination: a language model may only *rephrase* facts the graph produced.
// Its text is rejected (and the deterministic graph answer shown instead) if it introduces a
// medicine, food or number that is not in the facts or the caregiver's own question, if it
// claims a severity the facts don't contain, or if it calls anything "safe".

export interface GroundingCheck {
  ok: boolean;
  reasons: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(^|[^a-z0-9])${escape(w.toLowerCase())}(?=$|[^a-z0-9])`, "i");

/** Every numeric token in `text`, as written (so "2 g" and "2g" both yield "2"). */
const numbers = (text: string) => (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));

export function checkGrounded(
  text: string,
  facts: string,
  opts: { question: string; vocabulary: Iterable<string> },
): GroundingCheck {
  const reasons: string[] = [];
  const allowed = `${facts}\n${opts.question}`.toLowerCase();
  const lower = text.toLowerCase();

  // 1. Named things: any known medicine, ingredient, brand or food mentioned must already be in play.
  for (const name of new Set([...opts.vocabulary].map((n) => n.trim()).filter((n) => n.length >= 4))) {
    if (wordRe(name).test(lower) && !wordRe(name).test(allowed)) reasons.push(`mentions "${name}", which is not in the graph facts`);
  }

  // 2. Numbers: doses, counts and hours must come from the facts.
  const allowedNumbers = new Set(numbers(allowed));
  for (const n of new Set(numbers(text))) if (!allowedNumbers.has(n)) reasons.push(`uses the number ${n}, which is not in the graph facts`);

  // 3. Severity words must be backed by the facts.
  for (const word of ["serious", "moderate", "minor"]) {
    if (wordRe(word).test(lower) && !wordRe(word).test(allowed)) reasons.push(`calls something "${word}" without a ${word} finding`);
  }

  // 4. Policy: the graph can only say "no known conflict", never "safe".
  if (/\bsafe(ly)?\b/i.test(text) && !/\bsafe(ly)?\b/i.test(opts.question)) reasons.push('says "safe"; the graph can only say "no known conflict"');

  return { ok: reasons.length === 0, reasons };
}

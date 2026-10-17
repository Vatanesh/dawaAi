import type Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { DRUGBANK_PREFIX, getRepository } from "../graph/repository";
import { getMemory, softly, type CareNote } from "../memory/client";
import type { Finding, Medication } from "../types";
import type { FindingGroup } from "./graph-answer";
import { graphAnswer, who } from "./graph-answer";
import { checkGrounded } from "./grounding";
import { aiProvider, routerJSON, routerStream, type ChatMessage } from "./llm";
import { FOOD_WORDS, understand } from "./understand";

export type AskEvent =
  | { type: "step"; action: string; observation: string; tool?: { name: string; arguments: Record<string, unknown> } }
  // How the final text was produced: by the graph alone, or by an AI rewrite that passed the grounding check.
  | { type: "mode"; narrated: boolean; checked: boolean; rejected?: string[] }
  | { type: "text"; delta: string }
  | { type: "replace"; text: string } // the narrated answer failed part-way; show the graph answer instead
  | { type: "findings"; title: string; findings: Finding[] }
  | { type: "notes"; notes: CareNote[] }
  | { type: "meta"; verdict: "danger" | "caution" | "clear" | "info" }
  | { type: "done"; mode: "graph" | "claude" | "router" }
  | { type: "error"; message: string };

export const aiMode = aiProvider;

const NARRATOR = `You are DawaAI, a medication-safety assistant for family caregivers of older adults.
Rewrite the FACTS into a short answer to the caregiver's QUESTION.
Rules:
- Use only the FACTS. Never add an interaction, dose or claim that is not in them.
- If the FACTS say there is no known conflict, say "no known conflict in our graph", never "safe".
- Start with one bold sentence that answers the question directly. Then at most 4 short bullets.
- Under 110 words. Plain, calm language. Keep medicine names exactly as given.
- Never tell them to stop a prescribed medicine on their own; say who to ask (prescriber or pharmacist).
- Where the FACTS mark an item "DrugBank estimate", keep those words next to it: the severity there is estimated, not graded.`;

export async function ask(
  patientId: string,
  question: string,
  emit: (e: AskEvent) => void,
  signal?: AbortSignal,
) {
  emit({
    type: "step",
    action: "Reading the medication graph",
    observation: "Medicines, conditions, habits and care notes",
  });
  const repo = await getRepository();
  const memory = getMemory();
  // Everything independent is fetched at once: patient, memory, catalogue.
  const [context, history, notes, catalog, foods] = await Promise.all([
    repo.getPatientContext(patientId),
    softly(() => memory.chatHistory(patientId, 8), []),
    softly(() => memory.recall(patientId, question, 4), []),
    repo.listMedications(),
    repo.listFoods(),
  ]);
  if (!context) throw new Error("Unknown patient");

  const provider = aiProvider();
  const steps: {
    action: string;
    observation: string;
    tool?: { name: string; arguments: Record<string, unknown> };
  }[] = [];
  const step = (
    action: string,
    observation: string,
    tool?: (typeof steps)[number]["tool"],
  ) => {
    steps.push({ action, observation, tool });
    emit({ type: "step", action, observation, tool });
  };
  const findings = (g: FindingGroup) => emit({ type: "findings", ...g });


  let answer: string;
  if (provider === "claude") {
    const { claudeAnswer } = await import("./claude");
    const prior: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({
      role: m.role,
      content: m.text,
    }));
    while (prior.length && prior[0].role !== "user") prior.shift();
    answer = await claudeAnswer(patientId, context, question, prior, memory, {
      step: (a, o, tool) => step(a, o, tool),
      text: (delta) => emit({ type: "text", delta }),
      findings,
    });
    emit({ type: "mode", narrated: true, checked: false });
  } else {
    // Any of the 2k+ DrugBank drugs named in the question becomes checkable.
    const extra = await resolveDrugNames(question, catalog, repo);
    let u = understand(question, context, [...catalog, ...extra], foods);
    if (extra.length)
      step(
        "Found DrugBank drugs in the question",
        extra.map((m) => m.name).join(", "),
        {
          name: "drugbank.lookup",
          arguments: { names: extra.map((m) => m.name) },
        },
      );

    // Nothing recognised? Let the model read the question (brand names, misspellings, other languages).
    const nothing =
      !u.candidates.length &&
      !u.classAsked &&
      !u.focusRegimen.length &&
      !u.foods.length;
    if (nothing && provider === "router") {
      const parsed = await routerJSON<{
        medicines?: string[];
        foods?: string[];
      }>(
        [
          {
            role: "system",
            content:
              'Extract what a caregiver is asking about. Reply with JSON only: {"medicines": [generic names], "foods": [foods or drinks]}. Convert brand names to generic names (e.g. "Tylenol" -> "acetaminophen", "i-pill" -> "levonorgestrel"). Use [] when none.',
          },
          { role: "user", content: question },
        ],
        signal,
      ).catch(() => null);
      const names = [...(parsed?.medicines ?? []), ...(parsed?.foods ?? [])]
        .filter((x) => typeof x === "string")
        .slice(0, 6);
      if (names.length) {
        const hint = `${question} ${names.join(" ")}`;
        const more = await resolveDrugNames(hint, catalog, repo);
        u = understand(hint, context, [...catalog, ...extra, ...more], foods);
        step("Read the question with the language model", names.join(", "), {
          name: "llm.extract",
          arguments: { names },
        });
      }
    }

    const facts = await graphAnswer(
      patientId,
      context,
      u,
      notes,
      question,
      (s) => step(s.action, s.observation, s.tool),
    );
    for (const g of facts.groups) findings(g);
    emit({ type: "meta", verdict: facts.verdict });
    answer = facts.markdown;

    if (provider === "router") {
      const vocabulary = [
        ...catalog.flatMap((m) => [m.name, m.brand ?? "", ...m.ingredients.map((i) => i.name)]),
        ...foods.map((f) => f.name),
        ...Object.values(FOOD_WORDS).flat(),
      ].filter(Boolean);
      answer = await narrate({ question, context, facts: facts.markdown, history, vocabulary, repo, emit, step, signal });
    } else {
      emit({ type: "text", delta: answer });
      emit({ type: "mode", narrated: false, checked: true });
    }
  }

  if (notes.length) emit({ type: "notes", notes });
  emit({ type: "done", mode: provider });

  // Memory writes happen after the response has closed, so they never delay the answer.
  after(async () => {
    await softly(() => memory.addChat(patientId, "user", question), undefined);
    await Promise.all([
      softly(() => memory.addChat(patientId, "assistant", answer), undefined),
      softly(
        () =>
          memory.addTrace({
            patientId,
            task: question,
            outcome: answer.split("\n")[0].replace(/[*_]/g, "").slice(0, 280),
            success: true,
            steps: [{ thought: `Answer mode: ${provider}` }, ...steps],
          }),
        undefined,
      ),
    ]);
  });
}

// DrugBank lists everyday substances as drugs; a caregiver naming them is not proposing a medicine.
const NOT_MEDICINES = new Set(["caffeine", "ethanol", "nicotine", "water", "oxygen", "glucose", "sodium chloride", "sucrose", "alcohol"]);

async function resolveDrugNames(
  text: string,
  catalog: Medication[],
  repo: Awaited<ReturnType<typeof getRepository>>,
) {
  const curated = catalog.flatMap((m) => [m.name, ...m.ingredients.map((i) => i.name)]).map((n) => n.toLowerCase());
  const known = new Set(curated);
  const foodWords = new Set(Object.values(FOOD_WORDS).flat());
  const names = (await repo.findDrugNames(text))
    .filter((n) => {
      const l = n.toLowerCase();
      if (known.has(l) || foodWords.has(l) || NOT_MEDICINES.has(l)) return false;
      // "Vitamin D" when the list already has "Vitamin D3": that is the same thing, not a new medicine.
      return !curated.some((c) => c.startsWith(l + " ") || c.replace(/\d+$/, "") === l);
    })
    .slice(0, 4);
  const meds = await Promise.all(
    names.map((n) => repo.getMedication(`${DRUGBANK_PREFIX}${n}`)),
  );
  return meds.filter((m): m is Medication => !!m);
}

/**
 * Let the model rephrase the graph facts, then check the result against the graph before anyone
 * sees it. Anything it adds (a medicine, a number, a severity, the word "safe") gets the rewrite
 * rejected and the graph's own answer shown instead. Transport failures fall back the same way.
 */
async function narrate(args: {
  question: string;
  context: NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof getRepository>>["getPatientContext"]>>>;
  facts: string;
  history: { role: "user" | "assistant"; text: string }[];
  vocabulary: string[];
  repo: Awaited<ReturnType<typeof getRepository>>;
  emit: (e: AskEvent) => void;
  step: (action: string, observation: string, tool?: { name: string; arguments: Record<string, unknown> }) => void;
  signal?: AbortSignal;
}) {
  const { question, context, facts, history, emit, step, signal } = args;
  const w = who(context);
  const messages: ChatMessage[] = [
    { role: "system", content: NARRATOR },
    ...history.slice(-4).map((m) => ({ role: m.role, content: m.text.slice(0, 600) })),
    {
      role: "user",
      content: `PATIENT: ${context.patient.name}, ${context.patient.age}, called "${w.name}" by the caregiver.\nQUESTION: ${question}\nFACTS:\n${facts}`,
    },
  ];
  const fallback = (reason: string, rejected?: string[]) => {
    console.warn("[router] showing the graph answer:", reason);
    emit({ type: "text", delta: facts });
    emit({ type: "mode", narrated: false, checked: true, rejected });
    return facts;
  };
  let text = "";
  let finish: string | null = null;
  try {
    for await (const delta of routerStream(messages, { maxTokens: 2000, signal, onFinish: (r) => (finish = r) })) text += delta;
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  }
  if (text.trim().length < 20) return fallback("empty answer");
  if (finish === "length") return fallback("answer was cut off");

  // Vocabulary = everything the graph knows by name, plus any DrugBank name the model used.
  const extraNames = await args.repo.findDrugNames(text).catch(() => [] as string[]);
  const check = checkGrounded(text, facts, { question, vocabulary: [...args.vocabulary, ...extraNames] });
  if (!check.ok) {
    step("Rejected the AI wording", check.reasons.join("; "), { name: "grounding.check", arguments: { rejected: check.reasons } });
    return fallback("grounding check failed", check.reasons);
  }
  step("Checked the AI wording against the graph", "Every medicine, number and severity it used is in the graph facts", { name: "grounding.check", arguments: { ok: true } });
  emit({ type: "text", delta: text });
  emit({ type: "mode", narrated: true, checked: true });
  return text;
}

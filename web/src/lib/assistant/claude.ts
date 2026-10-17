// Optional Claude mode: only used when ANTHROPIC_API_KEY is set. Claude answers by calling the
// same graph tools the free mode uses, so every claim stays grounded in the medication graph.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getRepository } from "../graph/repository";
import type { MemoryStore } from "../memory/client";
import { medLabel } from "../safety/engine";
import { checkSafety } from "../safety/service";
import type { Finding, PatientContext } from "../types";
import { SLOTS } from "../types";
import type { FindingGroup } from "./graph-answer";
import { who } from "./graph-answer";

const MODEL = "claude-opus-5-5";

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "check_medication",
    description:
      "Check a medicine the patient does NOT take yet against their whole regimen, food habits and conditions. Returns the interactions it would introduce, from the medication graph. Use a generic or brand name.",
    input_schema: {
      type: "object",
      properties: {
        medication: { type: "string", description: "Generic or brand name, e.g. 'warfarin' or 'Eliquis'" },
        slots: { type: "array", items: { type: "string", enum: SLOTS }, description: "When it would be taken, if known" },
      },
      required: ["medication"],
    },
  },
  {
    name: "search_medications",
    description:
      "Search the medication catalogue by name, brand or purpose (e.g. 'blood thinner', 'sleep'). Use it to find which specific medicines match a vague description before checking them.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "current_findings",
    description: "Interactions already present in the patient's current regimen, optionally only those involving one medicine they take.",
    input_schema: { type: "object", properties: { medication: { type: "string" } } },
  },
  {
    name: "check_food",
    description: "Known conflicts between a food or drink (grapefruit, alcohol, coffee, leafy greens, dairy...) and the patient's current medicines.",
    input_schema: { type: "object", properties: { food: { type: "string" } }, required: ["food"] },
  },
  {
    name: "recall_care_notes",
    description: "Search the caregiver's notes about this patient (falls, symptoms, preferences) stored in agent memory.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
].map((t) => ({ ...t, eager_input_streaming: true }) as Anthropic.Beta.BetaTool);

const inputs = {
  check_medication: z.object({ medication: z.string(), slots: z.array(z.enum(SLOTS as [string, ...string[]])).optional() }),
  search_medications: z.object({ query: z.string() }),
  current_findings: z.object({ medication: z.string().optional() }),
  check_food: z.object({ food: z.string() }),
  recall_care_notes: z.object({ query: z.string() }),
};

const compact = (f: Finding) => ({ severity: f.severity, kind: f.kind, title: f.title, detail: f.detail, recommendation: f.recommendation, graphPath: f.path.map((n) => `${n.label}:${n.name}`).join(" -> ") });

function systemPrompt(context: PatientContext) {
  const w = who(context);
  const regimen = context.regimen.map((r) => `- ${medLabel(r.medication)}: ${r.dose}; ${r.slots.join(", ")}; prescribed by ${r.prescriber}; for ${r.purpose}`).join("\n");
  const habits = context.habits.map((h) => `- ${h.food.name}: ${h.frequency}`).join("\n");
  return `You are DawaAI, a medication-safety assistant for family caregivers of older adults. You are talking to the caregiver of ${context.patient.name} (${context.patient.age}), whom they call "${w.name}".

Ground rules:
- Every interaction claim must come from a tool result. The tools query a medication knowledge graph; cite the graph path in plain words when helpful.
- If the graph has no edge between two things, say "no known conflict in our graph", never "it's safe".
- Never tell the caregiver to stop or change a prescribed medicine on their own. Point them to the prescriber or pharmacist, and say which conversation to have.
- If the caregiver is vague ("a new blood thinner"), search the catalogue and check the likely options rather than asking first.
- Be calm, concrete and brief: a one-line answer, then short bullets. Plain language, no jargon without a gloss. Use the caregiver's name for the patient ("${w.name}").
- Urgent symptoms (heavy bleeding, black stools, confusion, chest pain, fainting) mean: seek urgent care now.

${w.possessive} conditions: ${context.patient.conditions.map((c) => c.name).join(", ")}
Current medicines:
${regimen}
Food and drink habits:
${habits || "- none recorded"}`;
}

export interface ClaudeEvents {
  step: (action: string, observation: string, tool: { name: string; arguments: Record<string, unknown> }) => void;
  text: (delta: string) => void;
  findings: (group: FindingGroup) => void;
}

export async function claudeAnswer(
  patientId: string,
  context: PatientContext,
  question: string,
  history: Anthropic.Beta.BetaMessageParam[],
  memory: MemoryStore,
  on: ClaudeEvents,
): Promise<string> {
  const client = new Anthropic();
  const repo = await getRepository();
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: "user", content: question }];
  let answer = "";

  async function run(name: string, raw: unknown): Promise<string> {
    switch (name) {
      case "check_medication": {
        const { medication, slots } = inputs.check_medication.parse(raw);
        const [med] = await repo.searchMedications(medication, 1);
        if (!med) return `No medicine called "${medication}" in the graph.`;
        const res = (await checkSafety(patientId, { medicationId: med.id, slots: slots as never }))!;
        const mine = res.report.findings.filter((f) => f.involvesCandidate);
        on.findings({ title: `If it's ${medLabel(med)}`, findings: mine });
        on.step(`Checked ${medLabel(med)}`, `${mine.length} findings`, { name, arguments: { medication: med.id } });
        return JSON.stringify({ medication: medLabel(med), findings: mine.map(compact) });
      }
      case "search_medications": {
        const { query } = inputs.search_medications.parse(raw);
        const meds = await repo.searchMedications(query, 6);
        on.step(`Searched the catalogue for "${query}"`, meds.map((m) => m.name).join(", ") || "nothing", { name, arguments: { query } });
        return JSON.stringify(meds.map((m) => ({ name: medLabel(m), kind: m.kind, description: m.description, classes: m.ingredients.map((i) => `${i.drugClass} (${i.atc})`) })));
      }
      case "current_findings": {
        const { medication } = inputs.current_findings.parse(raw);
        const res = (await checkSafety(patientId))!;
        const target = medication ? context.regimen.find((r) => medLabel(r.medication).toLowerCase().includes(medication.toLowerCase())) : undefined;
        const fs = target ? res.report.findings.filter((f) => f.medicationIds.includes(target.medication.id)) : res.report.findings;
        on.step("Reviewed the current regimen", `${fs.length} findings`, { name, arguments: { medication } });
        if (target) on.findings({ title: medLabel(target.medication), findings: fs });
        return JSON.stringify(fs.map(compact));
      }
      case "check_food": {
        const { food } = inputs.check_food.parse(raw);
        const [f] = await repo.searchFoods(food);
        if (!f) return `No food called "${food}" in the graph.`;
        const res = (await checkSafety(patientId))!;
        const hits = res.report.findings.filter((x) => x.path.some((n) => n.id === `food:${f.id}`));
        const watch = res.report.watchFoods.filter((e) => e.food.id === f.id);
        on.step(`Looked up ${f.name}`, `${hits.length + watch.length} conflicts`, { name, arguments: { food: f.id } });
        return JSON.stringify({ food: f.name, habitFindings: hits.map(compact), otherConflicts: watch.map((e) => ({ ingredient: e.ingredient.name, severity: e.severity, effect: e.effect, recommendation: e.recommendation })) });
      }
      case "recall_care_notes": {
        const { query } = inputs.recall_care_notes.parse(raw);
        const notes = await memory.recall(patientId, query, 4);
        on.step("Recalled care notes", `${notes.length} notes`, { name, arguments: { query } });
        return JSON.stringify(notes.map((n) => ({ date: n.createdAt.slice(0, 10), kind: n.kind, text: n.text })));
      }
    }
    return `Unknown tool ${name}`;
  }

  for (let turn = 0; turn < 8; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: systemPrompt(context),
      tools,
      messages,
    });
    for await (const event of stream)
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        answer += event.delta.text;
        on.text(event.delta.text);
      }
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") break;
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length || message.stop_reason !== "tool_use") break;
    messages.push({ role: "assistant", content: message.content });
    const results = await Promise.all(
      calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          return { type: "tool_result", tool_use_id: c.id, content: await run(c.name, c.input) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: c.id, is_error: true, content: err instanceof z.ZodError ? `INVALID_INPUT ${JSON.stringify(c.input)}` : String(err) };
        }
      }),
    );
    messages.push({ role: "user", content: results });
    if (answer && !answer.endsWith("\n")) {
      answer += "\n\n";
      on.text("\n\n");
    }
  }
  return answer;
}

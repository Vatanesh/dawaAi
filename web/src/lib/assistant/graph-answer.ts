// Deterministic answers composed from the graph and the safety engine. They are the free answer
// mode and the facts a language model narrates from, so they stay short and factual.

import type { CareNote } from "../memory/client";
import { medLabel } from "../safety/engine";
import { checkSafety } from "../safety/service";
import type { Finding, Medication, PatientContext, SafetyResponse, Severity } from "../types";
import type { Understanding } from "./understand";

export interface FindingGroup {
  title: string;
  findings: Finding[];
}

export interface GraphAnswer {
  verdict: "danger" | "caution" | "clear" | "info";
  markdown: string;
  groups: FindingGroup[];
  steps: { action: string; observation: string; tool?: { name: string; arguments: Record<string, unknown> } }[];
}

const WORD: Record<Severity, string> = { major: "serious", moderate: "moderate", minor: "minor" };

export function who(context: PatientContext) {
  const name = context.patient.relation || context.patient.name.split(" ")[0];
  return { name, possessive: `${name}'s`, pronoun: context.patient.sex === "female" ? "her" : context.patient.sex === "male" ? "his" : "their" };
}

function tally(findings: Finding[]): string {
  const c = { major: 0, moderate: 0, minor: 0 };
  const est = { major: 0, moderate: 0, minor: 0 };
  for (const f of findings) {
    c[f.severity]++;
    if (f.source === "drugbank") est[f.severity]++;
  }
  // DrugBank severities are estimated from its wording, so they are counted separately.
  const parts = (Object.keys(c) as Severity[]).filter((s) => c[s]).map((s) => `${c[s]} ${WORD[s]}${est[s] ? ` (${est[s]} DrugBank estimate${est[s] > 1 ? "s" : ""})` : ""}`);
  return parts.length ? parts.join(", ") : "no known issues";
}

const verdictOf = (fs: Finding[]): GraphAnswer["verdict"] =>
  fs.some((f) => f.severity === "major") ? "danger" : fs.some((f) => f.severity === "moderate") ? "caution" : "clear";

const short = (s: string) => s.split(/(?<=\.)\s/)[0].replace(/\.$/, "");
const bullet = (f: Finding) => `- **${f.title}** (${WORD[f.severity]}${f.source === "drugbank" ? ", DrugBank estimate" : ""}): ${short(f.recommendation)}.`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const SYMPTOMS: { words: RegExp; effects: RegExp; label: string }[] = [
  { words: /drows|sleepy|groggy|sedat/i, effects: /drows|sedat|sleepi|grogg/i, label: "drowsiness" },
  { words: /dizz|light.?headed|faint/i, effects: /dizz|light-?headed|faint/i, label: "dizziness" },
  { words: /confus|memory|forget/i, effects: /confus|delirium|memory/i, label: "confusion" },
  { words: /bleed|bruis|black stool|nosebleed/i, effects: /bleed|bruis/i, label: "bleeding or bruising" },
  { words: /fall|fell/i, effects: /\bfalls?\b/i, label: "falls" },
  { words: /muscle|ache|cramp/i, effects: /muscle|myopathy|cramp/i, label: "muscle aches or cramps" },
  { words: /tired|fatigue|weak/i, effects: /tired|fatigue/i, label: "tiredness" },
];

/** Findings touching a regimen medicine or a food. */
function touching(findings: Finding[], target: { medId?: string; foodId?: string }) {
  return findings.filter((f) => (target.medId ? f.medicationIds.includes(target.medId) : f.path.some((n) => n.id === `food:${target.foodId}`)));
}

export async function graphAnswer(
  patientId: string,
  context: PatientContext,
  u: Understanding,
  notes: CareNote[],
  question: string,
  onStep?: (s: GraphAnswer["steps"][number]) => void,
): Promise<GraphAnswer> {
  const w = who(context);
  const steps: GraphAnswer["steps"] = [];
  // Steps stream to the UI as they happen, not after the whole answer is ready.
  const addStep = (st: GraphAnswer["steps"][number]) => {
    steps.push(st);
    onStep?.(st);
  };
  const groups: FindingGroup[] = [];
  const out: string[] = [];
  let verdict: GraphAnswer["verdict"] = "info";

  const options: Medication[] = u.candidates.length ? u.candidates : (u.classAsked?.options ?? []);
  if (u.classAsked)
    addStep({
      action: `Read "${u.classAsked.label.replace(/ \(.*\)/, "")}" as ATC ${u.classAsked.atcPrefixes.join("/")}, then listed the medicines in those classes from the graph`,
      observation: u.classAsked.options.map((m) => m.name).join(", "),
      tool: { name: "ontology.resolveClass", arguments: { atc: u.classAsked.atcPrefixes } },
    });

  const current = async () => {
    const res = (await checkSafety(patientId))!;
    addStep({ action: `Checked ${w.possessive} ${context.regimen.length} medicines`, observation: tally(res.report.findings), tool: { name: "safety.check", arguments: { patientId } } });
    return res;
  };

  if (options.length) {
    // A new medicine (or a vague class of them): what would each option add?
    const results: { med: Medication; mine: Finding[] }[] = [];
    // Several named medicines are usually being started together ("put on furosemide and digoxin"),
    // so check them as one set, including against each other, unless the wording compares them.
    const together = !u.classAsked && options.length > 1 && !/\b(or|instead|which|better|either|versus|vs)\b/i.test(question);
    if (together) {
      const res: SafetyResponse = (await checkSafety(patientId, options.map((m) => ({ medicationId: m.id }))))!;
      const mine = res.report.findings.filter((f) => f.involvesCandidate);
      const combo: Medication = { ...options[0], id: "together", brand: undefined, name: options.map((m) => m.name).join(" + ") };
      results.push({ med: combo, mine });
      addStep({ action: `Checked ${combo.name} together against ${w.possessive} graph`, observation: tally(mine), tool: { name: "safety.check", arguments: { patientId, candidates: options.map((m) => m.id) } } });
    }
    // Alternatives are independent checks, so run them in parallel.
    await Promise.all(
      (together ? [] : options).map(async (med) => {
        const res: SafetyResponse = (await checkSafety(patientId, { medicationId: med.id }))!;
        const mine = res.report.findings.filter((f) => f.involvesCandidate);
        results.push({ med: res.report.candidate ?? med, mine });
        addStep({ action: `Checked ${medLabel(med)} against ${w.possessive} graph`, observation: tally(mine), tool: { name: "safety.check", arguments: { patientId, candidate: med.id } } });
      }),
    );
    results.sort((a, b) => score(a.mine) - score(b.mine));
    verdict = verdictOf(results.flatMap((r) => r.mine));

    const targets = [
      ...u.focusRegimen.map((r) => ({ label: `${w.pronoun} ${r.medication.kind === "supplement" ? r.medication.name.toLowerCase() : r.medication.name}`, medId: r.medication.id })),
      ...u.foods.map((f) => ({ label: f.name.toLowerCase(), foodId: f.id })),
    ];
    const targetLines: string[] = [];
    for (const t of targets) {
      const per = results.map((r) => ({ r, hit: touching(r.mine, t)[0] }));
      const hits = per.filter((x) => x.hit);
      if (!hits.length) {
        targetLines.push(`- **${cap(t.label)}**: no known conflict in our graph${results.length > 1 ? " with any of them" : ""}.`);
        continue;
      }
      const parts = hits.map(({ r, hit }) => `${r.med.name} ${WORD[hit!.severity]}${hit!.source === "drugbank" ? " (DrugBank estimate)" : ""} (${short(hit!.detail).toLowerCase()})`);
      const clear = per.filter((x) => !x.hit).map((x) => x.r.med.name);
      targetLines.push(`- **${cap(t.label)}**: ${parts.join("; ")}${clear.length ? `. No known conflict in our graph with ${clear.join(" or ")}` : ""}.`);
    }

    if (results.length > 1) {
      const what = u.classAsked ? `${results.length} common ${u.classAsked.label.replace(/ \(.*\)/, "")}` : `${results.length} options`;
      if (targetLines.length) {
        // The caregiver named specific things: answer those first, then the overview.
        out.push(`**${cap(what)} checked against ${w.possessive} list. What you asked about:**`, "", ...targetLines, "", "**Each option overall**", "");
      } else out.push(`**${cap(what)} checked against ${w.possessive} list.**`, "");
      for (const r of results) {
        const top = r.mine.find((f) => f.severity !== "minor");
        out.push(`- **${medLabel(r.med)}**: ${tally(r.mine)}${top ? `; main issue: ${top.title}` : ""}.`);
      }
    } else {
      const r = results[0];
      const important = r.mine.filter((f) => f.severity !== "minor");
      out.push(
        important.length
          ? `**${medLabel(r.med)} adds ${tally(r.mine)} ${r.mine.length === 1 ? "issue" : "issues"} for ${w.name}.**`
          : `**No serious or moderate conflicts for ${medLabel(r.med)} in ${w.possessive} graph.**`,
        "",
        ...important.slice(0, 4).map(bullet),
      );
    }
    for (const r of results) groups.push({ title: medLabel(r.med), findings: r.mine });
    if (targetLines.length && results.length === 1) out.push("", "**What you asked about**", "", ...targetLines);
    const serious = results.flatMap((r) => r.mine.filter((f) => f.severity === "major"));
    if (serious.length && results.length > 1) out.push("", `**First:** ${short(serious[0].recommendation)}.`);
  } else if (u.foods.length) {
    const res = await current();
    for (const f of u.foods) {
      const hits = touching(res.report.findings, { foodId: f.id });
      const watch = res.report.watchFoods.filter((e) => e.food.id === f.id);
      if (!hits.length && !watch.length) {
        out.push(`**${f.name}: no known conflict with ${w.possessive} medicines.**`, "");
        verdict = verdict === "info" ? "clear" : verdict;
        continue;
      }
      const sev = [...hits.map((h) => h.severity), ...watch.map((e) => e.severity)];
      verdict = sev.includes("major") ? "danger" : verdict === "danger" ? verdict : "caution";
      // The headline repeats what the strongest edge says (curated before estimated, then by
      // severity); it never adds a verdict of its own.
      const rank = (x: { severity: Severity; source?: string }) => (x.source === "drugbank" ? 10 : 0) + SEVERITY_ORDER[x.severity];
      const strongest = [
        ...hits.map((h) => ({ name: h.title.replace(` + ${f.name.toLowerCase()}`, ""), severity: h.severity, source: h.source, rec: h.recommendation })),
        ...watch.map((e) => ({ name: e.ingredient.name, severity: e.severity, source: e.source, rec: e.recommendation })),
      ].sort((x, y) => rank(x) - rank(y))[0];
      const total = hits.length + watch.length;
      out.push(`**${f.name}: ${total} known ${total === 1 ? "conflict" : "conflicts"} with ${w.possessive} medicines. With ${strongest.name}: ${short(strongest.rec).toLowerCase()}.**`, "");
      out.push(...hits.slice(0, 4).map(bullet));
      for (const e of watch.slice(0, 3)) out.push(`- **${e.ingredient.name}** (${WORD[e.severity]}): ${short(e.recommendation)}.`);
      out.push("");
      groups.push({ title: f.name, findings: hits });
    }
  } else if (u.focusRegimen.length) {
    const res = await current();
    for (const r of u.focusRegimen) {
      const hits = res.report.findings.filter((f) => f.medicationIds.includes(r.medication.id));
      const advice = res.report.labelAdvice.filter((a) => a.medicationId === r.medication.id).map((a) => a.text);
      const avoid = res.report.watchFoods.filter((e) => r.medication.ingredients.some((i) => i.id === e.ingredient.id)).map((e) => e.food.name.toLowerCase());
      verdict = verdictOf(hits);
      out.push(`**${medLabel(r.medication)}** (${r.dose}, ${r.slots.join(" and ") || "no set time"}): ${tally(hits)}.`, "");
      out.push(...hits.filter((f) => f.severity !== "minor").slice(0, 4).map(bullet));
      if (avoid.length) out.push(`- **Also avoid**: ${[...new Set(avoid)].join(", ")}.`);
      if (advice.length) out.push(`- **How to take**: ${advice.join(" ")}`);
      out.push("");
      groups.push({ title: medLabel(r.medication), findings: hits });
    }
  } else if (/\b(when|what time|schedule|timing|space|apart|together)\b/i.test(question)) {
    const res = await current();
    const s = res.schedule;
    verdict = s.clashesBefore || s.tips.length ? "caution" : "clear";
    out.push(s.clashesBefore ? `**${s.clashesBefore} timing ${s.clashesBefore === 1 ? "clash" : "clashes"} in ${w.possessive} day.**` : `**${cap(w.possessive)} timing looks fine.**`, "");
    for (const m of s.moves) out.push(`- **Move ${m.name}** from ${m.from.join("/")} to ${m.to.join("/")}: ${short(m.reason)}.`);
    for (const t of s.tips) out.push(`- ${t.text}`);
    if (s.moves.length) out.push("", "You can apply the suggested schedule in the Schedule tab.");
  } else {
    const symptom = SYMPTOMS.find((s) => s.words.test(question));
    const res = await current();
    if (symptom) {
      const hits = res.report.findings.filter((f) => symptom.effects.test(`${f.title} ${f.detail}`));
      verdict = hits.length ? verdictOf(hits) : "info";
      out.push(
        hits.length
          ? `**${hits.length} ${hits.length === 1 ? "finding" : "findings"} on ${w.possessive} list ${hits.length === 1 ? "mentions" : "mention"} ${symptom.label}.**`
          : `**No finding in ${w.possessive} graph mentions ${symptom.label}.** Mention it to the doctor.`,
        "",
        ...hits.slice(0, 5).map(bullet),
      );
      groups.push({ title: `Findings that mention ${symptom.label}`, findings: hits });
    } else {
      const important = res.report.findings.filter((f) => f.severity !== "minor");
      verdict = res.report.verdict;
      out.push(`**${cap(w.possessive)} list: ${tally(res.report.findings)}.**`, "", ...important.slice(0, 4).map(bullet));
      groups.push({ title: "Most important now", findings: important });
    }
  }

  const relevantNotes = notes.filter((n) => n.mentions.some((m) => m.type === "Symptom" || m.type === "CareEvent") || /fall|dizz|bruis|bleed|confus|drows/i.test(n.text));
  if (relevantNotes.length && (options.length || u.focusRegimen.length)) {
    const n = relevantNotes[0];
    const bleeding = options.some((m) => m.ingredients.some((i) => i.atc?.startsWith("B01")));
    out.push("", `**From care notes:** "${n.text}"${bleeding && /fall|dizz/i.test(n.text) ? " Mention this fall to the prescriber before a blood thinner is started." : ""}`);
    addStep({ action: "Recalled care notes", observation: `${relevantNotes.length} relevant`, tool: { name: "memory.recall", arguments: { patientId } } });
  }

  return { verdict, markdown: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), groups: groups.filter((g) => g.findings.length), steps };
}

const SEV_WEIGHT: Record<Severity, number> = { major: 100, moderate: 10, minor: 1 };
const SEVERITY_ORDER: Record<Severity, number> = { major: 0, moderate: 1, minor: 2 };
const score = (fs: Finding[]) => fs.reduce((s, f) => s + SEV_WEIGHT[f.severity], 0);

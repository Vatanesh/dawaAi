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
    type Watch = SafetyResponse["report"]["watchFoods"][number];
    // `watch` = food edges for the option that the person does not consume yet (asked-about foods).
    const results: { med: Medication; mine: Finding[]; watch: Watch[] }[] = [];
    const watchFor = (res: SafetyResponse, meds: Medication[]) =>
      res.report.watchFoods.filter((e) => meds.some((m) => m.ingredients.some((i) => i.id === e.ingredient.id)));
    // Several named medicines are usually being started together ("put on furosemide and digoxin"),
    // so check them as one set, including against each other, unless the wording compares them.
    const together = !u.classAsked && options.length > 1 && !/\b(or|instead|which|better|either|versus|vs)\b/i.test(question);
    if (together) {
      const res: SafetyResponse = (await checkSafety(patientId, options.map((m) => ({ medicationId: m.id }))))!;
      const mine = res.report.findings.filter((f) => f.involvesCandidate);
      const combo: Medication = { ...options[0], id: "together", brand: undefined, name: options.map((m) => m.name).join(" + ") };
      results.push({ med: combo, mine, watch: watchFor(res, options) });
      addStep({ action: `Checked ${combo.name} together against ${w.possessive} graph`, observation: tally(mine), tool: { name: "safety.check", arguments: { patientId, candidates: options.map((m) => m.id) } } });
    }
    // Alternatives are independent checks, so run them in parallel.
    await Promise.all(
      (together ? [] : options).map(async (med) => {
        const res: SafetyResponse = (await checkSafety(patientId, { medicationId: med.id }))!;
        const mine = res.report.findings.filter((f) => f.involvesCandidate);
        results.push({ med: res.report.candidate ?? med, mine, watch: watchFor(res, [med]) });
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
      const per = results.map((r) => {
        const f = touching(r.mine, t)[0];
        const e = "foodId" in t ? r.watch.find((x) => x.food.id === t.foodId) : undefined;
        const hit = f
          ? { severity: f.severity, source: f.source, detail: f.detail }
          : e
            ? { severity: e.severity, source: e.source, detail: `${e.effect} ${e.recommendation}` }
            : undefined;
        return { r, hit };
      });
      const hits = per.filter((x) => x.hit);
      // Name both sides of the pair so the wording cannot be read as "X conflicts with nothing".
      const pair = results.length > 1 ? `${cap(t.label)} + any of them` : `${cap(t.label)} + ${results[0].med.name}`;
      if (!hits.length) {
        targetLines.push(`- **${pair}**: no known conflict in our graph.`);
        continue;
      }
      const parts = hits.map(({ r, hit }) => `${r.med.name} ${WORD[hit!.severity]}${hit!.source === "drugbank" ? " (DrugBank estimate)" : ""} (${short(hit!.detail).toLowerCase()})`);
      const clear = per.filter((x) => !x.hit).map((x) => x.r.med.name);
      targetLines.push(`- **${cap(t.label)}**: ${parts.join("; ")}${clear.length ? `. No known conflict in our graph with ${clear.join(" or ")}` : ""}.`);
    }
    // A food the caregiver asked about may already clash with medicines on the list.
    if (u.foods.length) {
      const cur = await current();
      for (const f of u.foods) {
        const on = [
          ...touching(cur.report.findings, { foodId: f.id }).map((h) => `${h.title.replace(` + ${f.name.toLowerCase()}`, "")} (${WORD[h.severity]})`),
          ...cur.report.watchFoods.filter((e) => e.food.id === f.id && context.regimen.some((r) => r.medication.ingredients.some((i) => i.id === e.ingredient.id))).map((e) => `${e.ingredient.name} (${WORD[e.severity]})`),
        ];
        if (on.length) targetLines.push(`- **${f.name} with what ${w.pronoun} already takes**: ${[...new Set(on)].join(", ")}.`);
      }
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
      const important = hits.filter((f) => f.severity !== "minor");
      const when = r.slots.join(" and ") || "no set time";
      out.push(
        important.length
          ? `**${medLabel(r.medication)}** (${r.dose}, ${when}): ${tally(hits)}.`
          : hits.length
            ? `**${medLabel(r.medication)}** (${r.dose}, ${when}): nothing serious or moderate in ${w.possessive} graph; ${hits.length} minor ${hits.length === 1 ? "thing" : "things"} to know.`
            : `**${medLabel(r.medication)}** (${r.dose}, ${when}): no known conflicts in ${w.possessive} graph.`,
        "",
      );
      // When nothing serious exists, the minor items are the answer, so show them.
      out.push(...(important.length ? important : hits).slice(0, 4).map(bullet));
      if (avoid.length) out.push(`- **Also avoid**: ${[...new Set(avoid)].join(", ")}.`);
      if (advice.length) out.push(`- **How to take**: ${advice.join(" ")}`);
      out.push("");
      groups.push({ title: medLabel(r.medication), findings: hits });
    }
  } else if (u.conditions.length) {
    // "Is anything on his list a problem for his diabetes?"
    const res = await current();
    for (const c of u.conditions) {
      const hits = res.report.findings.filter((f) => f.path.some((n) => n.id === `cond:${c.id}`));
      const treats = context.regimen.filter((r) => PURPOSE_FOR_CONDITION.some(([cond, re]) => cond.test(c.name) && re.test(`${r.purpose ?? ""} ${r.medication.description ?? ""}`)));
      verdict = hits.length ? verdictOf(hits) : "clear";
      out.push(
        hits.length
          ? `**${hits.length} ${hits.length === 1 ? "medicine is" : "medicines are"} flagged for ${w.possessive} ${c.name.toLowerCase()}.**`
          : `**Nothing on ${w.possessive} list is flagged for ${w.pronoun} ${c.name.toLowerCase()} in the graph.**`,
        "",
        ...hits.slice(0, 5).map(bullet),
      );
      if (treats.length) out.push(`- **Taken for it**: ${treats.map((r) => medLabel(r.medication)).join(", ")}.`);
      out.push("");
      groups.push({ title: c.name, findings: hits });
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
    } else if (u.overview) {
      const important = res.report.findings.filter((f) => f.severity !== "minor");
      verdict = res.report.verdict;
      out.push(`**${cap(w.possessive)} list: ${tally(res.report.findings)}.**`, "", ...important.slice(0, 4).map(bullet));
      groups.push({ title: "Most important now", findings: important });
    } else {
      // Nothing recognisable: say so instead of dumping the overview as if it answered the question.
      verdict = "info";
      out.push(
        `**I didn't find a medicine, food, condition or symptom in that question, so I can't check it against ${w.possessive} graph.**`,
        "",
        `I can check: a medicine by name or by what it's for ("${w.pronoun} blood pressure tablets", "Aleve"), a food or drink ("wine", "grapefruit"), one of ${w.possessive} conditions, a symptom ("dizzy", "drowsy"), or dose timing.`,
        "",
        `For the whole picture, ask "What's the overall situation with ${w.possessive} medicines?" (right now: ${tally(res.report.findings)}).`,
      );
    }
  }

  // A care note is brought up only when it is about a medicine in play, or when a new medicine is
  // being considered and the note records an event or symptom worth telling the prescriber.
  const inPlay = new Set([...u.focusRegimen.map((r) => r.medication.id), ...u.focusRegimen.flatMap((r) => r.medication.ingredients.map((i) => i.id))]);
  const relevantNotes = notes.filter(
    (n) =>
      n.mentions.some((m) => m.ref && inPlay.has(m.ref)) ||
      (options.length > 0 && (n.mentions.some((m) => m.type === "Symptom" || m.type === "CareEvent") || /fall|dizz|bruis|bleed|confus|drows/i.test(n.text))),
  );
  if (relevantNotes.length) {
    const n = relevantNotes[0];
    const bleeding = options.some((m) => m.ingredients.some((i) => i.atc?.startsWith("B01")));
    out.push("", `**From care notes:** "${n.text}"${bleeding && /fall|dizz/i.test(n.text) ? " Mention this fall to the prescriber before a blood thinner is started." : ""}`);
    addStep({ action: "Recalled care notes", observation: `${relevantNotes.length} relevant`, tool: { name: "memory.recall", arguments: { patientId } } });
  }

  return { verdict, markdown: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), groups: groups.filter((g) => g.findings.length), steps };
}

// Which recorded purpose a medicine serves for a given condition, for "taken for it" lines.
const PURPOSE_FOR_CONDITION: [RegExp, RegExp][] = [
  [/diabet/i, /blood sugar|diabet/i],
  [/blood pressure|hypertens/i, /blood pressure/i],
  [/thyroid/i, /thyroid/i],
  [/reflux|gerd/i, /heartburn|reflux|acid/i],
  [/depress/i, /mood|depress/i],
  [/insomnia/i, /sleep/i],
  [/osteoporosis/i, /bone/i],
  [/fibrillation/i, /rhythm|heart/i],
  [/arthritis/i, /pain|knee|joint/i],
];

const SEV_WEIGHT: Record<Severity, number> = { major: 100, moderate: 10, minor: 1 };
const SEVERITY_ORDER: Record<Severity, number> = { major: 0, moderate: 1, minor: 2 };
const score = (fs: Finding[]) => fs.reduce((s, f) => s + SEV_WEIGHT[f.severity], 0);

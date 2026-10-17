"use client";

import { ArrowUp, ChevronDown, Network, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useApp } from "@/components/app/app-context";
import { PatientAvatar, VerdictBadge } from "@/components/common/bits";
import { FindingRow } from "@/components/patient/FindingRow";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useChatHistory, useOverview, useSafety, useStatus } from "@/lib/client/api";
import type { AskEvent } from "@/lib/assistant/run";
import type { Finding } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  verdict?: "danger" | "caution" | "clear" | "info";
  steps?: { action: string; observation: string; tool?: { name: string; arguments: Record<string, unknown> } }[];
  narrated?: boolean; // AI rewrote the graph facts (and passed the grounding check)
  rejected?: string[]; // AI wording was rejected for these reasons; the graph answer is shown
  groups?: { title: string; findings: Finding[] }[];
  pending?: boolean;
  error?: string;
}

export function AskSheet() {
  const app = useApp();
  return (
    <Sheet open={app.ask.open} onOpenChange={(o) => !o && app.closeAsk()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[460px]">
        {app.patientId ? <Chat key={app.patientId} patientId={app.patientId} /> : <PickPerson />}
      </SheetContent>
    </Sheet>
  );
}

function PickPerson() {
  const app = useApp();
  const { data: people } = useOverview();
  return (
    <div className="p-5">
      <SheetHeader className="p-0">
        <SheetTitle>Who is the question about?</SheetTitle>
        <SheetDescription>Answers are checked against that person&apos;s medicines, habits and conditions.</SheetDescription>
      </SheetHeader>
      <ul className="mt-4 space-y-1">
        {people?.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted"
              onClick={() => app.openPatient(p.id)}
            >
              <PatientAvatar name={p.name} verdict={p.verdict} size="sm" />
              <span className="flex-1 text-sm font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.relation}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chat({ patientId }: { patientId: string }) {
  const app = useApp();
  const { data: history } = useChatHistory(patientId);
  const { data: safety } = useSafety(patientId);
  const { data: status } = useStatus();
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const sentPrompt = useRef<string | undefined>(undefined);

  const p = safety?.context.patient;
  const name = p?.relation || p?.name.split(" ")[0] || "them";
  const pron = p?.sex === "female" ? "her" : p?.sex === "male" ? "his" : "their";
  const shown = turns ?? history?.map((m, i) => ({ id: `h${i}`, role: m.role, text: m.text })) ?? [];

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const aid = crypto.randomUUID();
    setTurns((t) => [...(t ?? shown), { id: crypto.randomUUID(), role: "user", text: q }, { id: aid, role: "assistant", text: "", steps: [], groups: [], pending: true }]);
    const patch = (fn: (t: Turn) => Turn) => setTurns((all) => (all ?? []).map((t) => (t.id === aid ? fn(t) : t)));
    abort.current = new AbortController();
    try {
      const res = await fetch(`/api/patients/${patientId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: abort.current.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({})))?.error ?? "No answer came back.");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AskEvent;
          if (e.type === "text") patch((t) => ({ ...t, text: t.text + e.delta }));
          else if (e.type === "replace") patch((t) => ({ ...t, text: e.text }));
          else if (e.type === "step") patch((t) => ({ ...t, steps: [...(t.steps ?? []), e] }));
          else if (e.type === "findings") patch((t) => ({ ...t, groups: [...(t.groups ?? []), { title: e.title, findings: e.findings }] }));
          else if (e.type === "meta") patch((t) => ({ ...t, verdict: e.verdict }));
          else if (e.type === "mode") patch((t) => ({ ...t, narrated: e.narrated, rejected: e.rejected }));
          else if (e.type === "error") patch((t) => ({ ...t, error: e.message }));
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) patch((t) => ({ ...t, error: err instanceof Error ? err.message : "Something went wrong." }));
    } finally {
      patch((t) => ({ ...t, pending: false }));
      setBusy(false);
    }
  };

  // A prompt handed over from elsewhere (e.g. "Ask about this" on a finding) is sent once.
  useEffect(() => {
    const prompt = app.ask.prompt;
    if (prompt && sentPrompt.current !== prompt && history) {
      sentPrompt.current = prompt;
      void send(prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.ask.prompt, history]);

  const firstMed = safety?.context.regimen.find((r) => r.medication.kind === "prescription")?.medication.name;
  const suggestions = [
    `${name} was just prescribed a new blood thinner. Does it clash with ${pron} evening vitamins or grapefruit juice?`,
    `Can ${name} take ibuprofen for pain?`,
    firstMed ? `What should ${name} avoid while taking ${firstMed}?` : `Is grapefruit juice OK for ${name}?`,
    `Why might ${name} feel dizzy or drowsy?`,
    `When should ${name} take each medicine?`,
  ];

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="border-b px-5 py-4">
        <SheetTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> Ask about {name}
        </SheetTitle>
        <SheetDescription className="text-xs">
          Every answer is built from {name}&apos;s medication graph
          {status?.aiIssue || status?.ai === "graph" ? "" : "; AI only rephrases it, and its wording is checked against the graph"}.
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {shown.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Ask in your own words, for example:</p>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="block w-full rounded-xl border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-ring/40 hover:bg-muted/50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {shown.map((t) =>
          t.role === "user" ? (
            <p key={t.id} className="ml-10 rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
              {t.text}
            </p>
          ) : (
            <Answer key={t.id} turn={t} />
          ),
        )}
        <div ref={end} />
      </div>

      <form
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border bg-card p-1.5 shadow-xs focus-within:border-ring/50 focus-within:ring-3 focus-within:ring-ring/15">
          <label htmlFor="ask-input" className="sr-only">
            Your question
          </label>
          <textarea
            id="ask-input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={`Ask about ${name}'s medicines, food or timing`}
            className="field-sizing-content max-h-36 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {busy ? (
            <Button type="button" size="icon" variant="secondary" className="rounded-xl" aria-label="Stop" onClick={() => abort.current?.abort()}>
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon" className="rounded-xl" disabled={!input.trim()} aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Decision support, not medical advice. Confirm changes with a prescriber or pharmacist.</p>
      </form>
    </div>
  );
}

function Answer({ turn }: { turn: Turn }) {
  const steps = turn.steps ?? [];
  const groups = (turn.groups ?? []).filter((g) => g.findings.length);
  return (
    <div className="space-y-2">
      {(turn.verdict && turn.verdict !== "info") || steps.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {turn.verdict && turn.verdict !== "info" && <VerdictBadge verdict={turn.verdict} />}
          {!turn.pending && turn.narrated !== undefined && (
            <span
              className="rounded-full border px-2 text-[10px] leading-5 text-muted-foreground"
              title={turn.rejected?.length ? `AI wording rejected: ${turn.rejected.join("; ")}` : undefined}
            >
              {turn.narrated ? "AI wording, checked against the graph" : turn.rejected?.length ? "Graph answer (AI wording rejected)" : "Graph answer"}
            </span>
          )}
          {steps.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Network className="size-3.5" />
                {turn.pending ? steps[steps.length - 1].action : `Checked the graph in ${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
                <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ol className="mt-2 space-y-1 border-l pl-3 text-xs">
                  {steps.map((s, i) => (
                    <li key={i}>
                      <span>{s.action}</span>
                      <span className="block text-muted-foreground">{s.observation}</span>
                      {s.tool && (
                        <code className="mt-0.5 block truncate rounded bg-muted px-1.5 py-0.5 text-[10px]">
                          {s.tool.name} {JSON.stringify(s.tool.arguments)}
                        </code>
                      )}
                    </li>
                  ))}
                </ol>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      ) : null}

      {turn.pending && !turn.text && (
        <div className="flex gap-1 py-2" aria-label="Working">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      )}
      {turn.text && (
        <div className={cn("answer rounded-2xl rounded-tl-md bg-muted/60 px-3.5 py-2.5 text-sm leading-relaxed")}>
          <ReactMarkdown>{turn.text}</ReactMarkdown>
        </div>
      )}
      {turn.error && <p className="rounded-lg bg-major-wash p-2.5 text-xs text-major">{turn.error}</p>}

      {!turn.pending && groups.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-primary">
            Evidence: {groups.reduce((s, g) => s + g.findings.length, 0)} findings
            <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 space-y-2">
            {groups.map((g) => (
              <div key={g.title} className="rounded-xl border p-1">
                <p className="px-2.5 pt-1.5 text-[11px] font-semibold text-muted-foreground">{g.title}</p>
                {g.findings.slice(0, 6).map((f) => (
                  <FindingRow key={f.id} finding={f} />
                ))}
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

"use client";

import { ArrowRight, Building2, CheckCircle2, Database, ScrollText, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import useSWR from "swr";
import { brand } from "@/brand";
import { NumberTicker } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetcher } from "@/lib/client/api";
import type { GraphStats } from "@/lib/graph/stats";
import { cn } from "@/lib/utils";

const EXAMPLE = "My father was just prescribed a new blood thinner. Does this conflict with his current evening vitamins or his daily habit of drinking grapefruit juice?";

// A partner brand, applied live to show white-labelling is configuration, not code.
const PARTNER = { name: "Example Care Partner", color: "#2457c5" }; // fictional, for the preview only

export function About() {
  const { data: s } = useSWR<GraphStats>("/api/stats", fetcher, { revalidateOnFocus: false });
  const [partner, setPartner] = useState(false);
  const name = partner ? PARTNER.name : brand.name;

  return (
    <div className="min-h-dvh bg-background" style={partner ? ({ "--brand": PARTNER.color } as CSSProperties) : undefined}>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <Logo />
          {name}
        </Link>
        <Button asChild size="sm">
          <Link href="/app?p=ramesh">
            Open the demo <ArrowRight />
          </Link>
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-20">
        <section className="py-10 sm:py-16">
          <p className="text-sm font-semibold text-primary">Poly-pharmacy safety for the people you care for</p>
          <h1 className="mt-2 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Ten medicines. Four doctors. Nobody sees the whole list.</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Older adults with chronic illness often take 5 to 10 medicines prescribed by different doctors, plus supplements and daily habits. {name} puts all of it in
            one knowledge graph, so cross-interactions, food conflicts and dose timing are caught before they cause harm.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/app?p=ramesh">Open the demo</Link>
            </Button>
          </div>
        </section>

        <section aria-labelledby="graph-title" className="rounded-2xl border bg-card p-5 sm:p-7">
          <h2 id="graph-title" className="text-lg font-bold">
            The graph is the product
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Medical relationships are stored as a graph in Neo4j and queried directly. Every finding is a path through it.</p>
          <div className="mt-5 overflow-x-auto">
            <Path nodes={["Patient", "TAKES", "Medication", "CONTAINS", "Active ingredient", "INTERACTS_WITH", "Active ingredient"]} />
            <Path nodes={["Active ingredient", "DEPLETES", "Nutrient"]} className="mt-2" />
            <Path nodes={["Active ingredient", "CONFLICTS_WITH", "Food", "", "Active ingredient", "IN_CLASS", "Drug class (WHO ATC)"]} className="mt-2" />
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Drugs" value={s?.drugs} hint="DrugBank layer" />
            <Stat label="Drug interactions" value={s?.drugInteractions} hint="in the graph" />
            <Stat label="Clinical rules" value={s?.curatedRules} hint="curated and graded" />
            <Stat label="Drug classes" value={s?.drugClasses} hint="WHO ATC ontology" />
            <Stat label="Checks logged" value={s?.checksLogged} hint="audit trail" />
            <Stat label="People" value={s?.people} hint={s ? `${s.regimenEntries} medicines tracked` : undefined} />
          </dl>
          {s && <p className="mt-3 text-xs text-muted-foreground">Live counts from {s.source === "neo4j" ? "the Neo4j database" : "the demo graph"}.</p>}
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-3">
          <Pillar icon={<Database />} title="The graph decides">
            A deterministic engine reads the person&apos;s medicines, habits and conditions from the graph and grades every interaction. No model is involved in deciding what is true.
          </Pillar>
          <Pillar icon={<ShieldCheck />} title="AI only rephrases">
            The assistant turns graph facts into plain language. Its wording is checked against the graph: a medicine, number or severity the facts don&apos;t contain gets the text rejected and
            replaced by the graph&apos;s own answer.
          </Pillar>
          <Pillar icon={<ScrollText />} title="Every check is on record">
            Each question and what-if is stored as a reasoning trace in Neo4j Agent Memory, with the graph steps behind it. Care teams can audit why advice was given.
          </Pillar>
        </section>

        <section className="mt-10 rounded-2xl border bg-card p-5 sm:p-7">
          <h2 className="text-lg font-bold">A caregiver asks</h2>
          <blockquote className="mt-3 border-l-2 border-primary pl-4 text-base italic">&ldquo;{EXAMPLE}&rdquo;</blockquote>
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            {[
              "“A new blood thinner” resolves through the ATC ontology to the common anticoagulants; each is checked against everything he takes.",
              "His evening multivitamin is read ingredient by ingredient: vitamin K matters for warfarin, vitamin E for rivaroxaban.",
              "Grapefruit juice is checked as a daily habit, not a hypothetical, including the timing of the dose.",
              "His recent fall, recorded in the care notes, is brought up because falls raise bleeding risk on an anticoagulant.",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                {t}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2">
          <Card className="gap-3 p-5">
            <div className="flex items-center gap-2 font-bold">
              <Users className="size-4 text-primary" /> For families
            </div>
            <p className="text-sm text-muted-foreground">
              A premium subscription for people caring for a parent or partner: check any medicine before the first dose, keep one day plan, ask questions in plain words, and
              hand the doctor a one-page report.
            </p>
          </Card>
          <Card className="gap-3 p-5">
            <div className="flex items-center gap-2 font-bold">
              <Building2 className="size-4 text-primary" /> For insurers, hospital networks and senior-care facilities
            </div>
            <p className="text-sm text-muted-foreground">
              White-labelled and installable on phones. A care-team overview triages every resident by risk, and the audit trail documents each check. Branding is
              configuration, not code:
            </p>
            <button
              type="button"
              onClick={() => setPartner((v) => !v)}
              className={cn(
                "flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                partner ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <span className="size-3 rounded-full" style={{ background: partner ? PARTNER.color : "var(--brand)" }} />
              {partner ? `Showing as ${PARTNER.name} (example only); switch back` : `Preview as a partner brand`}
            </button>
          </Card>
        </section>

        <footer className="mt-12 border-t pt-5 text-xs text-muted-foreground">
          Knowledge sources: curated, graded interactions; the DrugBank open interaction dataset; the WHO ATC classification; ICD-10 condition codes. {name} is decision
          support for caregivers and care teams, not a substitute for a prescriber or pharmacist.
        </footer>
      </main>
    </div>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--brand)" />
      <g transform="rotate(-35 32 32)">
        <rect x="12" y="23" width="40" height="18" rx="9" fill="#fff" />
        <path d="M32 23h11a9 9 0 0 1 0 18H32z" fill="color-mix(in oklab, var(--brand) 30%, white)" />
      </g>
    </svg>
  );
}

function Path({ nodes, className }: { nodes: string[]; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 whitespace-nowrap", className)}>
      {nodes.map((n, i) =>
        n === "" ? (
          <span key={i} className="mx-3 h-4 border-l" />
        ) : i % 2 === 0 ? (
          <span key={i} className="rounded-full border bg-background px-2.5 py-1 text-xs font-semibold">
            {n}
          </span>
        ) : (
          <span key={i} className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
            <span className="h-px w-3 bg-border" />
            {n}
            <ArrowRight className="size-3" />
          </span>
        ),
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value?: number; hint?: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <dd className="text-2xl font-bold tracking-tight">{value === undefined ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-muted" /> : <NumberTicker value={value} />}</dd>
      <dt className="text-xs font-medium">{label}</dt>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Pillar({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-2 p-5">
      <div className="flex items-center gap-2 font-bold [&_svg]:size-4 [&_svg]:text-primary">
        {icon}
        {title}
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </Card>
  );
}

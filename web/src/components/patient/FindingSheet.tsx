"use client";

import { Apple, Beaker, CircleUser, Diamond, Pill as PillIcon, Sparkles, Stethoscope, Triangle } from "lucide-react";
import { useApp } from "@/components/app/app-context";
import { SeverityBadge } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { KIND_LABEL } from "@/lib/client/ui";
import type { PathNode } from "@/lib/types";

const NODE: Record<PathNode["label"], { icon: React.ReactNode; label: string }> = {
  Patient: { icon: <CircleUser />, label: "Patient" },
  Medication: { icon: <PillIcon />, label: "Product" },
  ActiveIngredient: { icon: <Beaker />, label: "Active ingredient" },
  DrugClass: { icon: <Diamond />, label: "Drug class (WHO ATC)" },
  Food: { icon: <Apple />, label: "Food or drink" },
  Nutrient: { icon: <Triangle />, label: "Nutrient" },
  Condition: { icon: <Stethoscope />, label: "Condition" },
};

export function FindingSheet() {
  const app = useApp();
  const f = app.finding;
  return (
    <Sheet open={!!f} onOpenChange={(o) => !o && app.openFinding(null)}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {f && (
          <>
            <SheetHeader className="gap-2 border-b pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={f.severity} />
                <span className="text-xs text-muted-foreground">{KIND_LABEL[f.kind]}</span>
                {f.source === "drugbank" && <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">DrugBank</span>}
                {f.path.some((n) => n.label === "DrugClass") && <span className="rounded-full border border-primary/40 px-1.5 text-[10px] text-primary">Drug-class rule</span>}
              </div>
              <SheetTitle className="text-lg leading-snug">{f.title}</SheetTitle>
              <SheetDescription className="text-sm leading-relaxed">{f.detail}</SheetDescription>
            </SheetHeader>

            <div className="space-y-5 p-4">
              <section className="rounded-lg bg-accent p-3">
                <h3 className="text-xs font-semibold text-accent-foreground">What to do</h3>
                <p className="mt-1 text-sm">{f.recommendation}</p>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground">How the graph found it</h3>
                <ol className="relative space-y-3 border-l pl-5">
                  {f.path.map((n, i) => (
                    <li key={`${n.id}-${i}`} className="relative">
                      <span className="absolute top-0.5 -left-[29px] grid size-[18px] place-items-center rounded-full border bg-card text-muted-foreground [&_svg]:size-3">
                        {NODE[n.label].icon}
                      </span>
                      <p className="text-sm font-medium leading-tight">{n.name}</p>
                      <p className="text-[11px] text-muted-foreground">{NODE[n.label].label}</p>
                      {n.rel && <p className="mt-1 font-mono text-[10px] text-primary">-[:{n.rel}]-</p>}
                    </li>
                  ))}
                </ol>
              </section>

              {f.evidence && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold text-muted-foreground">DrugBank agrees</h3>
                  <blockquote className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">{f.evidence}</blockquote>
                </section>
              )}
              {f.source === "drugbank" && (
                <p className="text-xs text-muted-foreground">
                  DrugBank does not grade severity. This one is estimated from its wording and capped at moderate, so check it with a pharmacist.
                </p>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  app.openFinding(null);
                  app.openAsk(`Explain "${f.title}" in simple terms and what we should do.`);
                }}
              >
                <Sparkles /> Ask about this
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

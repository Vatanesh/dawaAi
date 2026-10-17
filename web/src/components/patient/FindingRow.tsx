"use client";

import { ChevronRight } from "lucide-react";
import { useApp } from "@/components/app/app-context";
import { SeverityDot } from "@/components/common/bits";
import { KIND_LABEL } from "@/lib/client/ui";
import type { Finding } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FindingRow({ finding, showNew }: { finding: Finding; showNew?: boolean }) {
  const app = useApp();
  return (
    <button
      type="button"
      onClick={() => app.openFinding(finding)}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        showNew && finding.involvesCandidate && "bg-accent/60",
      )}
    >
      <SeverityDot severity={finding.severity} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{finding.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{finding.recommendation}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
        {showNew && finding.involvesCandidate && <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground">New</span>}
        {finding.source === "drugbank" && <span className="rounded-full border px-1.5 text-[10px] leading-4 text-muted-foreground">DrugBank</span>}
        <span className="text-xs text-muted-foreground">{KIND_LABEL[finding.kind]}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

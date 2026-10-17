"use client";

import { ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KIND_LABEL, SEVERITY } from "@/lib/client/ui";
import type { FindingKind, SafetyReport, Severity } from "@/lib/types";
import { FindingRow } from "./FindingRow";

export function InteractionsTab({ report }: { report: SafetyReport }) {
  const trial = !!report.candidate;
  const [kind, setKind] = useState<FindingKind | "all">("all");
  const [onlyNew, setOnlyNew] = useState(true);
  const kinds = useMemo(() => [...new Set(report.findings.map((f) => f.kind))], [report.findings]);
  const shown = report.findings.filter((f) => (kind === "all" || f.kind === kind) && (!trial || !onlyNew || f.involvesCandidate));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => setKind((v as FindingKind) || "all")}>
          <ToggleGroupItem value="all" className="px-3 text-xs">All</ToggleGroupItem>
          {kinds.map((k) => (
            <ToggleGroupItem key={k} value={k} className="px-3 text-xs">
              {KIND_LABEL[k]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {trial && (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} className="accent-[var(--brand)]" />
            Only what the new medicine changes
          </label>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-6" />} title={trial ? "No conflicts from this medicine here" : "Nothing in this category"}>
          The graph has no known interaction for this selection.
        </EmptyState>
      ) : (
        (["major", "moderate", "minor"] as Severity[]).map((s) => {
          const group = shown.filter((f) => f.severity === s);
          if (!group.length) return null;
          return (
            <Card key={s} className="gap-1 p-2">
              <p className={`px-2.5 pt-1 pb-1 text-xs font-semibold ${SEVERITY[s].text}`}>
                {SEVERITY[s].label} · {group.length}
              </p>
              {group.map((f) => (
                <FindingRow key={f.id} finding={f} showNew={trial} />
              ))}
            </Card>
          );
        })
      )}
    </div>
  );
}

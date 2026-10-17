"use client";

import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useStatus, useTraces } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/ui";
import { cn } from "@/lib/utils";

/** Audit trail: every check and answer, with the graph steps behind it (reasoning memory). */
export function ActivityTab({ patientId }: { patientId: string }) {
  const { data: traces } = useTraces(patientId);
  const { data: status } = useStatus();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Every check and answer with the steps behind it
        {status?.memory === "neo4j-agent-memory"
          ? ", stored as reasoning traces in Neo4j Agent Memory for audit."
          : status?.memory === "neo4j-read"
            ? ", read from Neo4j Agent Memory (new checks are kept for this session only)."
            : "."}
      </p>
      {traces?.length === 0 && (
        <EmptyState icon={<History className="size-6" />} title="No activity yet">
          Check a medicine or ask a question and it will be recorded here.
        </EmptyState>
      )}
      <Card className="gap-0 divide-y p-0">
        {traces?.map((t) => (
          <Collapsible key={t.id} open={open === t.id} onOpenChange={(o) => setOpen(o ? t.id : null)}>
            <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
              <span className={cn("size-2 shrink-0 rounded-full", t.success === false ? "bg-major" : "bg-primary")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t.task}</span>
                {t.outcome && <span className="block truncate text-xs text-muted-foreground">{t.outcome.replace(/[*_]/g, "")}</span>}
              </span>
              <time dateTime={t.startedAt} className="shrink-0 text-xs text-muted-foreground">{relativeTime(t.startedAt)}</time>
              <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open === t.id && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="space-y-2 px-4 pb-4 pl-9 text-xs">
                {t.steps.length === 0 && <li className="text-muted-foreground">No detailed steps.</li>}
                {t.steps.map((s, i) => (
                  <li key={i}>
                    {s.action && <p className="font-medium">{s.action}</p>}
                    {(s.observation || s.thought) && <p className="text-muted-foreground">{s.observation ?? s.thought}</p>}
                    {s.tools.map((tool, j) => (
                      <code key={j} className="mt-1 block truncate rounded bg-muted px-2 py-1 text-[11px]">
                        {tool.name} {JSON.stringify(tool.arguments)}
                      </code>
                    ))}
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        ))}
        {!traces && <div className="h-24 animate-pulse" />}
      </Card>
    </div>
  );
}

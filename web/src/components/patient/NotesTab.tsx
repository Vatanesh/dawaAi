"use client";

import { CalendarClock, Eye, Heart, Loader2, NotebookPen } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { send, useNotes, useStatus } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/ui";
import type { CareNote } from "@/lib/memory/client";
import { cn } from "@/lib/utils";

const KINDS: { id: CareNote["kind"]; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "observation", label: "Noticed", icon: <Eye />, hint: "More bruising on his arms this week" },
  { id: "event", label: "Happened", icon: <CalendarClock />, hint: "Fell getting out of bed on Tuesday night" },
  { id: "preference", label: "Preference", icon: <Heart />, hint: "Finds large tablets hard to swallow" },
];

const MENTION: Record<string, string> = {
  MentionedDrug: "border-border",
  MentionedFood: "border-moderate/40 text-moderate",
  MentionedCondition: "border-major/30",
  Symptom: "bg-minor-wash text-minor border-transparent",
  CareEvent: "bg-major-wash text-major border-transparent",
};

export function NotesTab({ patientId, name }: { patientId: string; name: string }) {
  const { data: notes, error, mutate } = useNotes(patientId);
  const { data: status } = useStatus();
  const [kind, setKind] = useState<CareNote["kind"]>("observation");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // Optimistic: the note shows at once; linking it in agent memory takes a second or two.
  const save = async () => {
    const body = text.trim();
    if (body.length < 2) return;
    setBusy(true);
    setText("");
    const temp: CareNote = { id: `pending-${Date.now()}`, text: body, kind, createdAt: new Date().toISOString(), mentions: [] };
    try {
      await mutate(
        async (current) => {
          const note = await send<CareNote>(`/api/patients/${patientId}/notes`, { text: body, kind });
          toast.success("Note saved", { description: note.mentions.length ? `Linked: ${note.mentions.map((m) => m.name).join(", ")}` : undefined });
          return [note, ...(current ?? [])];
        },
        { optimisticData: (current) => [temp, ...(current ?? [])], rollbackOnError: true, revalidate: false },
      );
    } catch (e) {
      setText(body);
      toast.error(e instanceof Error ? e.message : "The note wasn't saved");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card className="h-fit gap-3 p-4">
        <div>
          <p className="font-semibold">Add a note about {name}</p>
          <p className="text-xs text-muted-foreground">
            Remembered and brought up when it matters, like a recent fall when a blood thinner is considered.
          </p>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => v && setKind(v as CareNote["kind"])} className="w-full">
          {KINDS.map((k) => (
            <ToggleGroupItem key={k.id} value={k.id} className="flex-1 text-xs [&_svg]:size-3.5">
              {k.icon} {k.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          }}
          placeholder={`e.g. ${KINDS.find((k) => k.id === kind)!.hint}`}
          aria-label="Note"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {status?.memory === "neo4j-agent-memory" ? "Stored in Neo4j Agent Memory" : "Stored for this session"}
          </span>
          <Button size="sm" disabled={busy || text.trim().length < 2} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />} Save note
          </Button>
        </div>
      </Card>

      <div className="space-y-2">
        {error && <p className="rounded-lg bg-major-wash p-3 text-sm text-major">Notes are unavailable: {error.message}</p>}
        {notes?.length === 0 && (
          <EmptyState icon={<NotebookPen className="size-6" />} title="No notes yet">
            Write down dizziness, a fall, a missed dose. Every future check uses it.
          </EmptyState>
        )}
        {!notes && !error && Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}
        {notes?.map((n) => {
          const k = KINDS.find((x) => x.id === n.kind) ?? KINDS[0];
          return (
            <Card key={n.id} className={cn("gap-2 p-3.5", n.id.startsWith("pending-") && "opacity-60")}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-3.5">
                {k.icon}
                <span className="font-medium text-foreground">{k.label}</span>
                <time dateTime={n.createdAt} className="ml-auto">{relativeTime(n.createdAt)}</time>
              </div>
              <p className="text-sm">{n.text}</p>
              {n.mentions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {n.mentions.map((m) => (
                    <span key={`${m.type}-${m.name}`} className={cn("rounded-full border px-2 py-0.5 text-[11px]", MENTION[m.type] ?? "border-border")}>
                      {m.name}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

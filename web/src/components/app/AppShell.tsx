"use client";

import {
  Compass,
  LayoutGrid,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  Info,
} from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { brand } from "@/brand";
import { AskSheet } from "@/components/ask/AskSheet";
import { PatientAvatar } from "@/components/common/bits";
import { Overview } from "@/components/overview/Overview";
import { FindingSheet } from "@/components/patient/FindingSheet";
import { MedicineDialog } from "@/components/patient/MedicineDialog";
import { PatientDialog } from "@/components/patient/PatientDialog";
import { Workspace } from "@/components/patient/Workspace";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOverview, useStatus } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useApp } from "./app-context";
import { CommandMenu } from "./CommandMenu";
import { Tour, tourSeen } from "./Tour";

export function AppShell() {
  const app = useApp();
  const { data: people } = useOverview();

  // First launch: start the tour once the real data has loaded (so it can point at it).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || !people || tourSeen()) return;
    autoStarted.current = true;
    const t = setTimeout(() => app.startTour(), 500);
    return () => clearTimeout(t);
  }, [people, app]);

  // ⌘K / Ctrl+K opens search; "/" opens Ask.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        app.openCommand("all");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-4 pb-24 sm:px-6 lg:px-8 lg:pb-10">
          {app.patientId ? (
            <Workspace key={app.patientId} patientId={app.patientId} />
          ) : (
            <Overview />
          )}
        </main>
      </div>

      <Button
        size="lg"
        data-tour="ask-mobile"
        onClick={() => app.openAsk()}
        className="fixed right-4 bottom-4 z-40 h-12 rounded-full px-5 shadow-lg lg:hidden"
      >
        <Sparkles /> Ask
      </Button>

      <CommandMenu />
      <AskSheet />
      <FindingSheet />
      <PatientDialog />
      <MedicineDialog />
      <Tour />
    </div>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-2 font-bold tracking-tight">
      <svg width="24" height="24" viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="16" fill="var(--brand)" />
        <g transform="rotate(-35 32 32)">
          <rect x="12" y="23" width="40" height="18" rx="9" fill="#fff" />
          <path
            d="M32 23h11a9 9 0 0 1 0 18H32z"
            fill="color-mix(in oklab, var(--brand) 30%, white)"
          />
        </g>
      </svg>
      {brand.name}
    </span>
  );
}

function Sidebar() {
  const app = useApp();
  const { data: people } = useOverview();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-14 items-center px-5">
        <button
          type="button"
          onClick={() => app.openPatient(null)}
          className="rounded-md"
        >
          <Logo />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        <button
          type="button"
          onClick={() => app.openPatient(null)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium",
            !app.patientId
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          <LayoutGrid className="size-4" /> Care overview
        </button>
        <Link
          href="/"
          className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Info className="size-4" /> Why {brand.name}
        </Link>

        <div className="mt-5 mb-1.5 flex items-center justify-between px-2.5">
          <span className="text-xs font-semibold text-muted-foreground">
            People
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => app.openPatientDialog()}
                aria-label="Add a person"
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Add a person</TooltipContent>
          </Tooltip>
        </div>
        <ul className="space-y-0.5" data-tour="people">
          {people?.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => app.openPatient(p.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
                  app.patientId === p.id
                    ? "bg-sidebar-accent"
                    : "hover:bg-sidebar-accent",
                )}
              >
                <PatientAvatar name={p.name} verdict={p.verdict} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.relation ? `${p.relation} · ` : ""}
                    {p.medicationCount} meds
                  </span>
                </span>
                {p.counts.major > 0 && (
                  <span className="rounded-full bg-major-wash px-1.5 text-[10px] leading-4 font-bold text-major">
                    {p.counts.major}
                  </span>
                )}
              </button>
            </li>
          ))}
          {!people &&
            Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="mx-2 my-1.5 h-8 animate-pulse rounded-lg bg-muted"
              />
            ))}
        </ul>
      </nav>
      <SystemStatus />
    </aside>
  );
}

function SystemStatus() {
  const app = useApp();
  const { data: s } = useStatus();
  const { resolvedTheme, setTheme } = useTheme();
  const items = s
    ? [
        {
          label: s.graph === "neo4j" ? "Neo4j graph" : "Demo graph",
          ok: s.graph === "neo4j",
        },
        {
          label:
            s.memory === "neo4j-agent-memory" ? "Agent memory" : "Local memory",
          ok: s.memory === "neo4j-agent-memory",
        },
        {
          label: s.aiIssue
            ? "Graph answers (AI wording off)"
            : s.ai === "router"
              ? "Graph answers, AI wording checked"
              : s.ai === "claude"
                ? "Claude with graph tools"
                : "Graph answers",
          ok: true,
          title: s.aiIssue ?? undefined,
        },
      ]
    : [];
  return (
    <div className="flex items-end justify-between gap-2 border-t px-4 py-3">
      <ul className="space-y-1 text-[11px] text-muted-foreground">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-1.5" title={i.title}>
            <span
              className={cn(
                "size-1.5 rounded-full",
                i.ok ? "bg-clear" : "bg-muted-foreground/40",
              )}
            />
            {i.label}
          </li>
        ))}
      </ul>
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Take the tour"
              onClick={() => app.startTour()}
            >
              <Compass />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Take the tour</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle dark mode"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="hidden dark:block" />
          <Moon className="dark:hidden" />
        </Button>
      </div>
    </div>
  );
}

function TopBar() {
  const app = useApp();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <button
        type="button"
        className="lg:hidden"
        onClick={() => app.openPatient(null)}
      >
        <Logo />
      </button>
      <button
        type="button"
        onClick={() => app.openCommand("all")}
        className="ml-auto flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:border-ring/40 lg:ml-0"
      >
        <Search className="size-4" />
        <span className="truncate">Search any medicine or person…</span>
        <Kbd className="ml-auto hidden sm:inline-flex">Ctrl K</Kbd>
      </button>
      <Button
        onClick={() => app.openAsk()}
        className="ml-auto hidden lg:inline-flex"
        data-tour="ask"
      >
        <Sparkles /> Ask {brand.name}
      </Button>
    </header>
  );
}

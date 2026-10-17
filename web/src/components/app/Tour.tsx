"use client";

import { ArrowLeft, ArrowRight, Compass, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { brand } from "@/brand";
import { Button } from "@/components/ui/button";
import { useOverview } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useApp } from "./app-context";

export const TOUR_KEY = "dawaai:tour:v1";

export function tourSeen() {
  try {
    return localStorage.getItem(TOUR_KEY) === "done";
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}

interface Step {
  /** data-tour value(s) to spotlight; the first visible one wins. None = centred card. */
  target?: string[];
  title: string;
  body: React.ReactNode;
  /** Runs when the step opens (e.g. navigate to the screen the step talks about). */
  before?: () => void;
}

const PAD = 8;
const GAP = 14;
const CARD_W = 360;

/** Guided first-run tour: a spotlight on the real UI with a compact step card. */
export function Tour() {
  const app = useApp();
  const { data: people } = useOverview();
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(220);
  const [viewport, setViewport] = useState(() =>
    typeof window === "undefined" ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight },
  );
  const observer = useRef<ResizeObserver | null>(null);
  // Measure each card as it mounts. The card animating out reports 0 while it leaves, so zero
  // heights are ignored rather than letting the next card dock off-screen.
  const measureCard = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(() => {
      if (el.offsetHeight > 0) setCardH(el.offsetHeight);
    });
    observer.current.observe(el);
  }, []);
  const nextRef = useRef<HTMLButtonElement>(null);
  const direction = useRef(1);

  const first = people?.[0];
  const firstName = first ? first.relation || first.name.split(" ")[0] : "them";
  const pronoun = first?.sex === "female" ? "her" : first?.sex === "male" ? "his" : "their";

  // The sidebar only exists on wide screens (lg); leave its step out of the count elsewhere.
  const wide = viewport.w >= 1024;

  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [
      {
        title: `Welcome to ${brand.name}`,
        body: "Every medicine, supplement, food habit and health condition in one graph, so clashes are caught before they cause harm. This short tour shows the essentials.",
        before: () => app.openPatient(null),
      },
      ...(wide
        ? [
            {
              target: ["people"],
              title: "The people you care for",
              body: "Each person has a status dot: red needs attention, amber is worth watching, green is stable. The badge counts serious issues.",
            },
          ]
        : []),
      {
        target: ["stats"],
        title: "Everyone at a glance",
        body: "Who needs attention, how many serious interactions there are and which doses need re-spacing, across everyone. Built for families and care teams alike.",
      },
    ];
    if (first) {
      list.push(
        {
          target: ["patient-card"],
          title: "Most urgent first",
          body: `People are sorted by risk. Let's open ${firstName}.`,
        },
        {
          target: ["check"],
          title: "Check before the first dose",
          body: (
            <>
              Search any of 2,000+ medicines (or press <kbd className="rounded border bg-muted px-1 text-[11px]">Ctrl K</kbd>). {brand.name} shows exactly what it would
              add before it&apos;s started.
            </>
          ),
          before: () => app.openPatient(first.id, "overview"),
        },
        {
          target: ["score"],
          title: "One safety score",
          body: "Across medicines, food and conditions. Serious issues weigh the most; minor ones barely move it.",
        },
        {
          target: ["attention"],
          title: "What needs attention",
          body: "The serious and moderate issues, with what to do. Tap any of them to see the graph path behind it.",
        },
        {
          target: ["today"],
          title: "Dosing times",
          body: "The day at a glance. Doses that block each other are flagged, and a safer schedule is suggested with one-tap apply.",
        },
        {
          target: ["tabs"],
          title: "Go deeper",
          body: "Every interaction, the full schedule, the knowledge graph itself, care notes and an audit trail of every check.",
        },
      );
    }
    list.push(
      {
        target: ["ask", "ask-mobile"],
        title: "Ask in plain words",
        body: `For example: "${firstName} was just prescribed a new blood thinner. Does it clash with ${pronoun} evening vitamins or grapefruit juice?" Answers come from the graph, with the evidence attached.`,
      },
      {
        title: "You're all set",
        body: (
          <>
            Replay this tour any time from the sidebar. To see how the graph works, the data behind it and who it&apos;s for, open{" "}
            <Link href="/" className="font-medium text-primary underline underline-offset-2">
              Why {brand.name}
            </Link>
            . Everything here is decision support: confirm changes with the prescriber or pharmacist.
          </>
        ),
      },
    );
    return list;
  }, [app, first, firstName, pronoun, wide]);

  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  const finish = useCallback(() => {
    try {
      localStorage.setItem(TOUR_KEY, "done");
    } catch {
      // Private mode: the tour simply may show again next time.
    }
    setIndex(0);
    setRect(null);
    app.endTour();
  }, [app]);

  const go = useCallback(
    (delta: number) => {
      direction.current = delta;
      const n = index + delta;
      if (n >= steps.length) finish();
      else setIndex(Math.max(0, n));
    },
    [index, steps.length, finish],
  );

  // Run the step's navigation once when it opens.
  useEffect(() => {
    if (app.tourOpen) step.before?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.tourOpen, index]);

  // Find the target (waiting for it to render after navigation), bring it into view and follow it.
  useEffect(() => {
    if (!app.tourOpen) return;
    let raf = 0;
    let scrolled = false;
    const started = performance.now();
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const tick = () => {
      setViewport((v) => (v.w === innerWidth && v.h === innerHeight ? v : { w: innerWidth, h: innerHeight }));
      if (!step.target) {
        setRect(null);
        return;
      }
      const els = step.target.flatMap((t) => [...document.querySelectorAll(`[data-tour="${t}"]`)]);
      const el = els.find(visible);
      if (!el) {
        // Present but hidden (e.g. desktop-only on a phone), or still missing after 5s: skip the step.
        if ((els.length && !els.some(visible)) || performance.now() - started > 5000) {
          setRect(null);
          go(direction.current);
          return;
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!scrolled) {
        scrolled = true;
        const r = el.getBoundingClientRect();
        if (r.top < 72 || r.bottom > innerHeight - 24) el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      }
      const r = el.getBoundingClientRect();
      setRect((prev) => (prev && Math.abs(prev.top - r.top) < 0.5 && Math.abs(prev.left - r.left) < 0.5 && prev.width === r.width && prev.height === r.height ? prev : r));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [app.tourOpen, step, go, reduce]);

  // Keyboard: arrows/Enter to move, Escape to leave. Focus stays on the primary action.
  useEffect(() => {
    if (!app.tourOpen) return;
    nextRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [app.tourOpen, index, go, finish]);

  if (!app.tourOpen || typeof document === "undefined") return null;

  const mobile = viewport.w < 640;
  const cardW = Math.min(CARD_W, viewport.w - 32);
  let pos: { top: number; left: number };
  if (!rect) {
    pos = { top: Math.max(16, (viewport.h - cardH) / 2), left: (viewport.w - cardW) / 2 };
  } else if (mobile) {
    // Phones: dock the card at whichever edge the target isn't using.
    const targetLow = rect.top + rect.height / 2 > viewport.h / 2;
    pos = { top: targetLow ? 16 : viewport.h - cardH - 16, left: 16 };
  } else {
    const below = rect.bottom + PAD + GAP;
    const above = rect.top - PAD - GAP - cardH;
    const top = below + cardH <= viewport.h - 16 ? below : above >= 16 ? above : Math.max(16, viewport.h - cardH - 16);
    const left = Math.min(Math.max(16, rect.left), viewport.w - cardW - 16);
    pos = { top, left };
  }

  // Whatever the layout decided, the card always stays fully on screen.
  pos.top = Math.min(Math.max(16, pos.top), Math.max(16, viewport.h - cardH - 16));
  pos.left = Math.min(Math.max(16, pos.left), Math.max(16, viewport.w - cardW - 16));

  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 380, damping: 36 };

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {/* Click shield: the tour owns the screen while it runs. */}
      <div className={cn("absolute inset-0", !rect && "bg-black/55 backdrop-blur-[2px]")} />
      {rect && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute rounded-2xl ring-2 ring-primary/80"
          style={{ boxShadow: "0 0 0 9999px rgb(4 10 9 / 0.55)" }}
          initial={false}
          animate={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
          transition={spring}
        />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          ref={measureCard}
          initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1, top: pos.top, left: pos.left }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1], top: spring, left: spring }}
          style={{ width: cardW }}
          className="absolute rounded-2xl border bg-card p-4 text-card-foreground shadow-2xl"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
              <Compass className="size-4" />
            </span>
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {index + 1} of {steps.length}
            </span>
            <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close the tour" onClick={finish}>
              <X />
            </Button>
          </div>
          <h2 id="tour-title" className="text-base font-bold leading-snug">
            {step.title}
          </h2>
          <p id="tour-body" className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {step.body}
          </p>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex gap-1" aria-hidden>
              {steps.map((_, i) => (
                <span key={i} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/25")} />
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {index === 0 ? (
                <Button variant="ghost" size="sm" onClick={finish}>
                  Skip
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => go(-1)} aria-label="Previous step">
                  <ArrowLeft />
                </Button>
              )}
              <Button ref={nextRef} size="sm" onClick={() => (last ? finish() : go(1))}>
                {index === 0 ? "Start the tour" : last ? "Done" : "Next"}
                {!last && <ArrowRight />}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}

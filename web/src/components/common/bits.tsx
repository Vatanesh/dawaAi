"use client";

import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";
import { initials, SEVERITY, VERDICT } from "@/lib/client/ui";
import type { SafetyReport, Severity } from "@/lib/types";

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const s = SEVERITY[severity];
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold", s.bg, s.text, className)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return <span aria-label={SEVERITY[severity].label} className={cn("inline-block size-2 shrink-0 rounded-full", SEVERITY[severity].dot, className)} />;
}

export function VerdictBadge({ verdict, className }: { verdict: SafetyReport["verdict"]; className?: string }) {
  const v = VERDICT[verdict];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold", v.bg, v.text, className)}>
      <span className={cn("size-1.5 rounded-full", v.dot)} aria-hidden />
      {v.label}
    </span>
  );
}

/** Counts up once when scrolled into view (respects reduced motion). */
export function NumberTicker({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    // Animate when scrolled into view; if that never happens (print, full-page capture, odd
    // scroll containers), show the real value after a moment anyway.
    if (!inView) {
      const t = setTimeout(() => mv.set(value), 1500);
      return () => clearTimeout(t);
    }
    if (reduce) return void mv.set(value);
    const c = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [inView, value, reduce, mv]);
  return <motion.span ref={ref} className={cn("tabular-nums", className)}>{rounded}</motion.span>;
}

/** Safety score ring, 0-100. */
export function ScoreRing({ score, verdict, size = 104 }: { score: number; verdict: SafetyReport["verdict"]; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const colour = verdict === "danger" ? "var(--major)" : verdict === "caution" ? "var(--moderate)" : "var(--clear)";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute text-center leading-none">
        <NumberTicker value={score} className="text-2xl font-bold" />
        <div className="mt-1 text-[10px] font-medium text-muted-foreground">of 100</div>
      </div>
    </div>
  );
}

export function PatientAvatar({ name, verdict, size = "md" }: { name: string; verdict?: SafetyReport["verdict"]; size?: "sm" | "md" | "lg" }) {
  const dims = size === "sm" ? "size-7 text-[11px]" : size === "lg" ? "size-12 text-base" : "size-9 text-xs";
  return (
    <span className="relative inline-flex shrink-0">
      <span className={cn("grid place-items-center rounded-full bg-accent font-bold text-accent-foreground", dims)}>{initials(name)}</span>
      {verdict && (
        <span className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card", VERDICT[verdict].dot)} aria-label={VERDICT[verdict].label} />
      )}
    </span>
  );
}

/** Segmented tabs with a sliding highlight (motion layout animation). */
export function AnimatedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div role="tablist" className={cn("relative flex items-center gap-0.5 overflow-x-auto rounded-xl bg-muted p-1 [scrollbar-width:none]", className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative z-0 flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`tab-${id}`}
                className="absolute inset-0 -z-10 rounded-lg bg-card shadow-sm ring-1 ring-border"
                transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}
              />
            )}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={cn("rounded-full px-1.5 text-[10px] leading-4 font-semibold", active ? "bg-primary text-primary-foreground" : "bg-background")}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <p className="text-sm font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

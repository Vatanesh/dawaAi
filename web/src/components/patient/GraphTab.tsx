"use client";

// Loaded only in the browser (see CareApp): the force-graph library touches window on import.
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { pillColour } from "@/lib/client/ui";
import type { GraphView, PathNode, Severity } from "@/lib/types";


type GNode = GraphView["nodes"][number] & { x?: number; y?: number };
type GLink = { source: string | GNode; target: string | GNode; type: string; severity?: Severity };

const RISK_TYPES = new Set(["INTERACTS_WITH", "CLASS_INTERACTS_WITH", "CONFLICTS_WITH", "CONTRAINDICATED_IN", "DEPLETES"]);

function useTokens() {
  const [t, setT] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const get = (k: string) => s.getPropertyValue(`--${k}`).trim();
      setT({ ink: get("foreground"), soft: get("muted-foreground"), line: get("border"), surface: get("card"), brand: get("primary") || get("brand"), brandWash: get("accent"), major: get("major"), moderate: get("moderate"), minor: get("minor") });
    };
    // Next frame so a just-toggled theme class has applied; then follow later toggles.
    const raf = requestAnimationFrame(read);
    const mo = new MutationObserver(() => requestAnimationFrame(read));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
    };
  }, []);
  return t;
}

const LEGEND: { label: PathNode["label"]; text: string }[] = [
  { label: "Patient", text: "Patient" },
  { label: "Medication", text: "Product" },
  { label: "ActiveIngredient", text: "Active ingredient" },
  { label: "DrugClass", text: "Drug class (ATC)" },
  { label: "Food", text: "Food or drink" },
  { label: "Condition", text: "Condition" },
  { label: "Nutrient", text: "Nutrient" },
];

export function GraphTab({ graph }: { graph: GraphView }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 520 });
  const [hover, setHover] = useState<string | null>(null);
  const [showMinor, setShowMinor] = useState(false);
  const t = useTokens();

  // Minor risks (mostly DrugBank background noise) are hidden by default to keep the picture readable.
  const minorCount = graph.links.filter((l) => RISK_TYPES.has(l.type) && l.severity === "minor").length;
  const view = useMemo(() => {
    if (showMinor) return graph;
    const links = graph.links.filter((l) => !(RISK_TYPES.has(l.type) && l.severity === "minor"));
    const keep = new Set(links.flatMap((l) => [l.source, l.target]));
    return { nodes: graph.nodes.filter((n) => keep.has(n.id) || n.label === "Patient"), links };
  }, [graph, showMinor]);
  const fg = useRef<ForceGraphMethods | undefined>(undefined);

  // Spread the layout out: the default forces pack a 30-node medical subgraph too tightly.
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force("charge")?.strength(-220);
    g.d3Force("link")?.distance((l: GLink) => (RISK_TYPES.has(l.type) ? 80 : 42));
    g.d3ReheatSimulation();
    const fit = setTimeout(() => g.zoomToFit(500, 56), 1400);
    return () => clearTimeout(fit);
  }, [view, t.ink]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: Math.max(420, Math.min(640, e.contentRect.width * 0.8)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fresh copies: the force engine mutates nodes and links in place.
  const data = useMemo(() => ({ nodes: view.nodes.map((n) => ({ ...n })) as GNode[], links: view.links.map((l) => ({ ...l })) as GLink[] }), [view]);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of view.links) {
      m.set(l.source, (m.get(l.source) ?? new Set()).add(l.target));
      m.set(l.target, (m.get(l.target) ?? new Set()).add(l.source));
    }
    return m;
  }, [view]);

  const sevColour = (s?: Severity) => (s === "major" ? t.major : s === "moderate" ? t.moderate : s === "minor" ? t.minor : t.line);
  const idOf = (x: string | GNode) => (typeof x === "string" ? x : x.id);
  const dim = (id: string) => hover !== null && hover !== id && !neighbours.get(hover)?.has(id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">The slice of the knowledge graph behind the findings. Hover or tap a node to trace it.</p>
        {minorCount > 0 && (
          <button
            type="button"
            aria-pressed={showMinor}
            onClick={() => setShowMinor((v) => !v)}
            className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:text-primary"
          >
            {showMinor ? "Hide" : "Show"} {minorCount} minor risks
          </button>
        )}
      </div>
      <div ref={wrap} className="overflow-hidden rounded-xl border bg-card">
        {t.ink && (
          <ForceGraph2D
            ref={fg}
            graphData={data}
            onEngineStop={() => fg.current?.zoomToFit(400, 48)}
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            cooldownTicks={120}
            nodeRelSize={6}
            linkColor={(o: object) => {
              const l = o as GLink;
              const faded = hover && !(idOf(l.source) === hover || idOf(l.target) === hover);
              const c = RISK_TYPES.has(l.type) ? sevColour(l.severity) : t.line;
              return faded ? `${c}33` : c;
            }}
            linkWidth={(o: object) => ((l: GLink) => (RISK_TYPES.has(l.type) ? (l.severity === "major" ? 3.5 : 2.2) : 1))(o as GLink)}
            linkLineDash={(o: object) => ((o as GLink).type === "CONSIDERING" || (o as GLink).type === "IN_CLASS" ? [4, 3] : null)}
            onNodeHover={(n: object | null) => setHover((n as GNode | null)?.id ?? null)}
            onNodeClick={(o: object) => {
              const id = (o as GNode).id;
              setHover((h) => (h === id ? null : id));
            }}
            nodeLabel={(o: object) => (o as GNode).name}
            nodeCanvasObjectMode={() => "replace"}
            nodeCanvasObject={(o: object, ctx: CanvasRenderingContext2D, scale: number) => {
              const n = o as GNode;
              const x = n.x ?? 0;
              const y = n.y ?? 0;
              ctx.globalAlpha = dim(n.id) ? 0.2 : 1;
              ctx.lineWidth = 1.2 / scale;
              ctx.setLineDash(n.candidate ? [3 / scale, 2 / scale] : []);
              let r = 5;
              switch (n.label) {
                case "Patient":
                  r = 11;
                  ctx.fillStyle = t.brand;
                  ctx.beginPath();
                  ctx.arc(x, y, r, 0, Math.PI * 2);
                  ctx.fill();
                  break;
                case "Medication": {
                  r = 8;
                  ctx.fillStyle = pillColour(n.id.slice(4));
                  ctx.strokeStyle = n.candidate ? t.brand : t.ink;
                  ctx.lineWidth = (n.candidate ? 2.2 : 1) / scale;
                  ctx.beginPath();
                  ctx.roundRect(x - 11, y - 6, 22, 12, 6);
                  ctx.fill();
                  ctx.stroke();
                  break;
                }
                case "ActiveIngredient":
                  r = 4;
                  ctx.fillStyle = t.surface;
                  ctx.strokeStyle = t.soft;
                  ctx.beginPath();
                  ctx.arc(x, y, r, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();
                  break;
                case "DrugClass":
                  r = 7;
                  ctx.fillStyle = t.brandWash;
                  ctx.strokeStyle = t.brand;
                  ctx.beginPath();
                  ctx.moveTo(x, y - r);
                  ctx.lineTo(x + r, y);
                  ctx.lineTo(x, y + r);
                  ctx.lineTo(x - r, y);
                  ctx.closePath();
                  ctx.fill();
                  ctx.stroke();
                  break;
                case "Food":
                  r = 6;
                  ctx.fillStyle = t.moderate;
                  ctx.beginPath();
                  ctx.roundRect(x - r, y - r, r * 2, r * 2, 2);
                  ctx.fill();
                  break;
                case "Nutrient":
                  r = 6;
                  ctx.fillStyle = t.minor;
                  ctx.beginPath();
                  ctx.moveTo(x, y - r);
                  ctx.lineTo(x + r, y + r * 0.8);
                  ctx.lineTo(x - r, y + r * 0.8);
                  ctx.closePath();
                  ctx.fill();
                  break;
                case "Condition":
                  r = 6;
                  ctx.strokeStyle = t.major;
                  ctx.lineWidth = 2.4 / scale;
                  ctx.beginPath();
                  ctx.arc(x, y, r, 0, Math.PI * 2);
                  ctx.stroke();
                  break;
              }
              const showLabel = n.label === "Patient" || n.label === "Medication" || scale > 1.6 || hover === n.id || neighbours.get(hover ?? "")?.has(n.id);
              if (showLabel) {
                const fontSize = Math.max(11 / scale, 2.5);
                ctx.font = `${n.label === "Patient" ? 700 : 500} ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = t.ink;
                ctx.fillText(n.name.length > 28 ? `${n.name.slice(0, 27)}…` : n.name, x, y + r + 2 / scale);
              }
              ctx.globalAlpha = 1;
              ctx.setLineDash([]);
            }}
            nodePointerAreaPaint={(o: object, colour: string, ctx: CanvasRenderingContext2D) => {
              const n = o as GNode;
              ctx.fillStyle = colour;
              ctx.beginPath();
              ctx.arc(n.x ?? 0, n.y ?? 0, 12, 0, Math.PI * 2);
              ctx.fill();
            }}
          />
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <LegendGlyph label={l.label} />
            {l.text}
          </li>
        ))}
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-major" aria-hidden />Serious risk</li>
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-moderate" aria-hidden />Moderate</li>
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-minor" aria-hidden />Minor</li>
      </ul>
    </div>
  );
}

function LegendGlyph({ label }: { label: PathNode["label"] }) {
  const map: Record<PathNode["label"], React.ReactNode> = {
    Patient: <span className="h-3.5 w-3.5 rounded-full bg-primary" />,
    Medication: <span className="h-2.5 w-5 rounded-full border border-foreground/60 bg-[#f2c14e]" />,
    ActiveIngredient: <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground" />,
    DrugClass: <span className="h-2.5 w-2.5 rotate-45 border border-primary bg-accent" />,
    Food: <span className="h-3 w-3 rounded-sm bg-moderate" />,
    Condition: <span className="h-3 w-3 rounded-full border-2 border-major" />,
    Nutrient: <span className="h-0 w-0 border-x-[6px] border-b-[10px] border-x-transparent border-b-minor" />,
  };
  return <span aria-hidden className="inline-flex w-5 justify-center">{map[label]}</span>;
}

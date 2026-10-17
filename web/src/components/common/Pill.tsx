import { pillColour, pillShape } from "@/lib/client/ui";
import type { Medication } from "@/lib/types";

/** The medicine's visual identity: same colour and shape everywhere it appears. */
export function Pill({ medication, size = 18, dashed = false }: { medication: Pick<Medication, "id" | "kind">; size?: number; dashed?: boolean }) {
  const fill = pillColour(medication.id);
  const shape = pillShape(medication.kind);
  const stroke = "rgb(15 31 27 / 0.28)";
  const common = { fill, stroke, strokeWidth: 1.1, strokeDasharray: dashed ? "3 2" : undefined };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      {shape === "round" && (
        <>
          <circle cx="12" cy="12" r="9" {...common} />
          <line x1="7.5" y1="12" x2="16.5" y2="12" stroke={stroke} strokeWidth="1.1" />
        </>
      )}
      {shape === "oval" && <ellipse cx="12" cy="12" rx="10" ry="6.5" {...common} />}
      {shape === "capsule" && (
        <g transform="rotate(-35 12 12)">
          <rect x="2.5" y="7.5" width="19" height="9" rx="4.5" {...common} />
          <path d="M12 7.5 h5 a4.5 4.5 0 0 1 0 9 h-5 z" fill="rgb(255 255 255 / 0.5)" />
        </g>
      )}
    </svg>
  );
}

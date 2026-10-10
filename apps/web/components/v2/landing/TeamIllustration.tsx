import { OwlSvg } from "@/components/v2/app/owl/OwlSvg";
import type { OwlAgent } from "@/components/v2/app/owl/owl-colors";

/** One still illustration of the Office idea: Agent OWL and six helper owls around a round table, each owl in the colour it has everywhere else (owl-colors.ts). Pure SVG, no 3D, no data. */
/** x = the owl's centre, bottom = where its feet are, w = its width (all in the drawing's units). The owls near the table edge stand a little behind it. */
const SEATS: { x: number; bottom: number; w: number; agent: OwlAgent; main?: boolean }[] = [
  { x: 320, bottom: 166, w: 96, agent: "main", main: true },
  { x: 158, bottom: 192, w: 78, agent: "lead_finder" },
  { x: 228, bottom: 168, w: 78, agent: "researcher" },
  { x: 412, bottom: 168, w: 78, agent: "requirement_analyst" },
  { x: 482, bottom: 192, w: 78, agent: "quote_writer" },
  { x: 100, bottom: 236, w: 78, agent: "followup_desk" },
  { x: 540, bottom: 236, w: 78, agent: "order_desk" },
];

export function TeamIllustration({ alt }: { alt: string }) {
  return (
    <svg viewBox="0 0 640 330" role="img" aria-label={alt} className="h-auto w-full">
      <ellipse cx="320" cy="250" rx="300" ry="62" fill="var(--v2-surface-2)" />
      {/* the owls behind and beside the table */}
      {SEATS.map((s) => (
        <g key={s.agent}>
          {s.main && <ellipse cx="320" cy={s.bottom - 4} rx="60" ry="14" fill="none" stroke="var(--v2-brand)" strokeWidth="4" />}
          <OwlSvg agent={s.agent} still box={{ x: s.x - s.w / 2, y: s.bottom - (s.w * 250) / 240, width: s.w }} />
        </g>
      ))}
      {/* the round table */}
      <ellipse cx="320" cy="214" rx="206" ry="62" fill="#e3c6a2" />
      <ellipse cx="320" cy="214" rx="206" ry="62" fill="none" stroke="var(--v2-brand)" strokeWidth="5" />
      <ellipse cx="320" cy="206" rx="170" ry="44" fill="#ecd5b6" opacity="0.7" />
      <circle cx="320" cy="206" r="9" fill="var(--v2-brand)" />
      {/* laptops */}
      {[118, 200, 262, 378, 440, 522].map((x, i) => (
        <rect key={i} x={x - 17} y={i < 2 || i > 3 ? 214 : 196} width="34" height="16" rx="3" fill="#4a4646" />
      ))}
      <rect x="302" y="192" width="36" height="16" rx="3" fill="#4a4646" />
    </svg>
  );
}

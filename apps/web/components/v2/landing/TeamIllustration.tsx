/** One still illustration of the Office idea: seven assistants around a round table. Pure SVG, no 3D, no data. */
const SEATS: { x: number; y: number; shirt: string; skin: string; hair: string; main?: boolean }[] = [
  { x: 320, y: 84, shirt: "#34323a", skin: "#b07a58", hair: "#5a5655", main: true },
  { x: 160, y: 120, shirt: "#c2410c", skin: "#c98e66", hair: "#1d1716" },
  { x: 222, y: 98, shirt: "#e4d2b6", skin: "#f0c8a6", hair: "#6b4a2f" },
  { x: 418, y: 98, shirt: "#6b7a3a", skin: "#6a4330", hair: "#100c0b" },
  { x: 480, y: 120, shirt: "#d9a21b", skin: "#e2b08a", hair: "#3a281d" },
  { x: 118, y: 196, shirt: "#c0627a", skin: "#8a5a3e", hair: "#0f0b0a" },
  { x: 522, y: 196, shirt: "#4a5ab8", skin: "#d6a07a", hair: "#43342a" },
];

export function TeamIllustration({ alt }: { alt: string }) {
  return (
    <svg viewBox="0 0 640 330" role="img" aria-label={alt} className="h-auto w-full">
      <ellipse cx="320" cy="250" rx="300" ry="62" fill="var(--v2-surface-2)" />
      {/* people behind and beside the table */}
      {SEATS.map((s, i) => (
        <g key={i} transform={`translate(${s.x} ${s.y})`}>
          {s.main && <ellipse cx="0" cy="40" rx="46" ry="12" fill="none" stroke="var(--v2-brand)" strokeWidth="4" />}
          <path d="M-26 52 C-26 24 -14 14 0 14 C14 14 26 24 26 52 Z" fill={s.shirt} />
          <circle cx="0" cy="-4" r="15" fill={s.skin} />
          <path d="M-15 -6 C-15 -22 -6 -26 0 -26 C8 -26 15 -20 15 -6 C8 -14 -8 -14 -15 -6 Z" fill={s.hair} />
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
      {/* the two people in front */}
      {[{ x: 214, shirt: "#e4d2b6", skin: "#f0c8a6", hair: "#6b4a2f" }, { x: 426, shirt: "#4a5ab8", skin: "#d6a07a", hair: "#43342a" }].map((s, i) => (
        <g key={i} transform={`translate(${s.x} 268)`}>
          <path d="M-30 58 C-30 26 -16 14 0 14 C16 14 30 26 30 58 Z" fill={s.shirt} />
          <circle cx="0" cy="-6" r="17" fill={s.skin} />
          <path d="M-17 -8 C-17 -26 -7 -30 0 -30 C9 -30 17 -23 17 -8 C9 -17 -9 -17 -17 -8 Z" fill={s.hair} />
        </g>
      ))}
    </svg>
  );
}

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
import type { Radar } from "@/lib/lead-finder/radar";

type W = Readonly<Record<string, string>>;
const TONE = { go: "bg-[#ff773c] shadow-[0_0_0_4px_rgba(255,119,60,.18)]", ask: "border-2 border-[#ff773c] bg-surface", quiet: "bg-muted/60" } as const;
const at = (v: number) => `${50 + v * 45}%`;

/**
 * The Lead Finder's radar (app v4 part 5, from app-Finder.png): the assistant's orb in the middle, rings in kilometres, and each business the provider gave a position as a pin (orange: ready to call or waiting for your OK; grey: skipped), the
 * best few with their area written beside them. The middle is the middle of the businesses found and the rings are kilometres from it (said under the picture): nothing here is a guess of where the owner is. Server markup; made-up
 * businesses in a demo are labelled as such by the page. A picture only: the cards beside it are the content.
 */
export function FinderRadar({ radar, w, around, checked }: { radar: Radar; w: W; /** the area of the latest search ("Hyderabad"), or null */ around: string | null; checked: { checked: number; worth: number } | null }) {
  return (
    <section aria-labelledby="fr-title" className="flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-3 sm:p-4" data-part="finder-radar">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="fr-title" className="sr-only">
          {w["lf.v4.radar"]}
        </h2>
        {around ? (
          <p className="m-0 inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold">
            <span aria-hidden="true" className="size-2 rounded-full bg-[#ff773c]" />
            {(w["lf.v4.around"] ?? "{area}").replace("{area}", around)}
          </p>
        ) : null}
      </div>
      <div role="img" aria-label={(w["lf.v4.radar.alt"] ?? "").replace("{n}", String(radar.positioned))} className="relative mx-auto aspect-square w-full max-w-[440px]">
        <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 size-full">
          <defs>
            <linearGradient id="fr-sweep" x1="0" y1="1" x2="0.4" y2="0">
              <stop offset="0" stopColor="#ff773c" stopOpacity="0" />
              <stop offset="1" stopColor="#ff773c" stopOpacity="0.28" />
            </linearGradient>
          </defs>
          <path d="M50 50 L50 5 A45 45 0 0 1 72 11 Z" fill="url(#fr-sweep)" />
          {radar.rings.map((r) => (
            <circle key={r.r} cx="50" cy="50" r={45 * r.r} fill="none" stroke="#c2410c" strokeOpacity={r.r === 1 ? 0.45 : 0.2} strokeWidth={r.r === 1 ? 0.5 : 0.35} strokeDasharray={r.r === 1 ? undefined : "1 1.4"} />
          ))}
          <line x1="5" y1="50" x2="95" y2="50" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.3" />
          <line x1="50" y1="5" x2="50" y2="95" stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.3" />
          {radar.rings.map((r) => (
            <text key={`t${r.r}`} x="51" y={50 - 45 * r.r + 3} fontSize="2.8" fill="#c2410c" fillOpacity="0.8">
              {(w["lf.v4.km"] ?? "{n} km").replace("{n}", String(r.km))}
            </text>
          ))}
        </svg>
        <div className="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full shadow-[0_6px_18px_-6px_rgba(30,30,36,.5)]">
          <AssistantOrb state="idle" />
        </div>
        {radar.pins.map((p) => (
          <span key={p.id} data-pin={p.id} data-tone={p.tone} style={{ position: "absolute", left: at(p.x), top: at(p.y) }}>
            <span aria-hidden="true" className={`absolute left-0 top-0 block -translate-x-1/2 -translate-y-1/2 rounded-full ${p.labelled ? "size-3" : "size-2"} ${TONE[p.tone]}`} />
            {p.labelled ? <span className="absolute left-2 top-1 max-w-[9rem] -translate-y-1/2 truncate whitespace-nowrap rounded-lg bg-surface px-2 py-0.5 text-xs font-semibold text-ink shadow-[0_2px_8px_rgba(30,30,36,.15)]">{p.label}</span> : null}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {checked ? (
          <p className="m-0 text-sm font-semibold text-ink" data-part="finder-checked">
            {(w["lf.v4.checked"] ?? "").replace("{n}", checked.checked.toLocaleString("en-IN")).replace("{m}", checked.worth.toLocaleString("en-IN"))}
          </p>
        ) : null}
        <p className="m-0 text-xs text-muted">{w["lf.v4.rings"]}</p>
      </div>
    </section>
  );
}

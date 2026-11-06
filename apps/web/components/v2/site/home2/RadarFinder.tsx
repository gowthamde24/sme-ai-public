"use client";

import * as React from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";

import { addScene, fontOf, isCalm, sceneTime, type Look } from "./scene";

type W = Readonly<Record<string, string>>;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
const TAU = 6.2832;
export const CITIES = ["Hyderabad", "Bengaluru", "Chennai", "Vijayawada"] as const;
export type City = (typeof CITIES)[number];
/** Each city's own four area names (the design's), for the four found businesses in turn. */
export const AREAS: Record<City, readonly [string, string, string, string]> = {
  Hyderabad: ["Ameerpet", "Dilsukhnagar", "Begum Bazar", "Kukatpally"],
  Bengaluru: ["Malleshwaram", "Jayanagar", "Chickpet", "Yeshwanthpur"],
  Chennai: ["T. Nagar", "Velachery", "Mylapore", "Anna Nagar"],
  Vijayawada: ["Governorpet", "Benz Circle", "One Town", "Gunadala"],
};
type Pin = { id: number; x: number; y: number; km: string; d: "call" | "ask" | "skip"; ang: number };
// the four found on this sweep (the design's): where they sit on the 780 × 520 map, how far, and the decision
const PINS: Pin[] = [
  { id: 0, x: 505, y: 165, km: "3.2 km", d: "call" as const },
  { id: 1, x: 545, y: 365, km: "9.1 km", d: "call" as const },
  { id: 2, x: 318, y: 338, km: "4.5 km", d: "skip" as const },
  { id: 3, x: 205, y: 132, km: "6.8 km", d: "ask" as const },
]
  .map((p) => ({ ...p, ang: (Math.atan2(p.y - 260, p.x - 390) + TAU) % TAU }))
  .sort((a, b) => a.ang - b.ang);
// the other businesses the sweep checks (fixed, so every visitor sees the same map)
const CANDS = (() => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 46 }, () => {
    const r = 40 + Math.sqrt(rnd()) * 196;
    const a = rnd() * TAU;
    return { x: 390 + Math.cos(a) * r, y: 260 + Math.sin(a) * r, ang: a };
  });
})();
const ROADS: [number, number][][] = [
  [[20, 60], [250, 140], [480, 230], [770, 500]],
  [[0, 200], [260, 230], [520, 200], [780, 150]],
  [[300, 0], [340, 180], [420, 340], [380, 520]],
  [[600, 0], [560, 160], [520, 300], [640, 520]],
  [[0, 460], [200, 400], [330, 380], [520, 480]],
];
/** Where the sweep is: its angle, and whether this is a fresh sweep (every third), when the found list fills again from empty. */
export function sweepAt(t: number, since: number): { a: number; fresh: boolean } {
  const A = Math.max(0, t - since) * 1.1;
  const cyc = Math.floor(A / TAU);
  return { a: A - cyc * TAU, fresh: cyc % 3 === 0 };
}

function drawRadar(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: Look, state: { city: City; since: number }, crop: boolean, sans: string): void {
  const k = crop ? W / 520 : W / 780;
  const cx = 390;
  const cy = 260;
  const R = 240;
  const st = look.calm ? { a: TAU - 0.01, fresh: false } : sweepAt(t, state.since);
  const a = st.a;
  const ink = look.dark ? "244,242,238" : "30,30,36";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, crop ? -130 * k : 0, 0);
  ctx.fillStyle = `rgba(${ink},.10)`;
  for (let x = 8; x < 780; x += 16)
    for (let y = 8; y < 520; y += 16) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, TAU);
      ctx.fill();
    }
  if (state.city === "Hyderabad") {
    ctx.fillStyle = "rgba(110,150,190,.16)";
    ctx.beginPath();
    ctx.ellipse(452, 212, 36, 22, -0.45, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(110,150,190,.22)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 300);
  ctx.bezierCurveTo(200, 280, 330, 330, 470, 300);
  ctx.bezierCurveTo(600, 270, 680, 330, 780, 320);
  ctx.stroke();
  for (const r of ROADS) {
    ctx.strokeStyle = `rgba(${ink},.07)`;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(r[0][0], r[0][1]);
    ctx.bezierCurveTo(r[1][0], r[1][1], r[2][0], r[2][1], r[3][0], r[3][1]);
    ctx.stroke();
    ctx.strokeStyle = look.dark ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.95)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.font = `600 11px ${sans}`;
  ctx.textAlign = "left";
  (
    [
      [80, "3 km"],
      [160, "6 km"],
      [240, "10 km"],
    ] as const
  ).forEach(([rr, label], i) => {
    ctx.strokeStyle = i === 2 ? "rgba(194,65,12,.35)" : "rgba(194,65,12,.18)";
    ctx.lineWidth = i === 2 ? 1.5 : 1;
    ctx.setLineDash(i === 2 ? [] : [3, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(194,65,12,.75)";
    ctx.fillText(label, cx + 6, cy - rr - 6);
  });
  ctx.strokeStyle = "rgba(194,65,12,.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  ctx.stroke();
  for (let d = 0; d < 72; d++) {
    const ang = (d * TAU) / 72;
    const r1 = d % 6 === 0 ? R - 10 : R - 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
    ctx.stroke();
  }
  // the sweep: a fading wedge behind a bright edge
  if ("createConicGradient" in ctx) {
    const g = ctx.createConicGradient(a - 1.3, cx, cy);
    g.addColorStop(0, "rgba(255,119,60,0)");
    g.addColorStop((1.3 / TAU) * 0.6, "rgba(255,119,60,.08)");
    g.addColorStop(1.3 / TAU, "rgba(255,119,60,.32)");
    g.addColorStop(1.3 / TAU + 0.002, "rgba(255,119,60,0)");
    g.addColorStop(1, "rgba(255,119,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
  }
  const ex = cx + Math.cos(a) * R;
  const ey = cy + Math.sin(a) * R;
  const lg = ctx.createLinearGradient(cx, cy, ex, ey);
  lg.addColorStop(0, "rgba(255,119,60,.1)");
  lg.addColorStop(1, "rgba(255,119,60,.95)");
  ctx.strokeStyle = lg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.fillStyle = "#ff773c";
  ctx.shadowColor = "rgba(255,119,60,.9)";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(ex, ey, 4, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  // every business the sweep checks lights up for a moment
  for (const c of CANDS) {
    const behind = (((a - c.ang) % TAU) + TAU) % TAU;
    const b = look.calm ? 0 : Math.max(0, 1 - behind / 1.4);
    ctx.fillStyle = b > 0 ? `rgba(255,119,60,${0.25 + b * 0.7})` : `rgba(${ink},.18)`;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2 + b * 1.5, 0, TAU);
    ctx.fill();
  }
  // the ones worth knowing about: a ping, a coloured pin, a name tag
  const names = AREAS[state.city];
  for (const p of PINS) {
    if (st.fresh && a < p.ang) continue;
    const age = ((((a - p.ang) % TAU) + TAU) % TAU) / 1.1;
    const col = p.d === "call" ? "255,119,60" : p.d === "ask" ? ink : "169,165,160";
    if (age < 1.6 && !look.calm) {
      ctx.strokeStyle = `rgba(${col},${0.7 * (1 - age / 1.6)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 + age * 22, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = look.dark ? "#1f1e23" : "#fff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, TAU);
    ctx.fill();
    if (p.d === "ask") {
      ctx.strokeStyle = `rgb(${ink})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5.5, 0, TAU);
      ctx.stroke();
    } else {
      ctx.fillStyle = `rgb(${col})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6.5, 0, TAU);
      ctx.fill();
    }
    ctx.font = `700 12px ${sans}`;
    const label = names[p.id];
    const tw = ctx.measureText(label).width;
    const bx = p.x + 14;
    const by = p.y - 26;
    ctx.fillStyle = look.dark ? "rgba(39,38,44,.95)" : "rgba(255,255,255,.95)";
    ctx.shadowColor = "rgba(30,30,36,.18)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw + 16, 22, 8);
    else ctx.rect(bx, by, tw + 16, 22);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = look.dark ? "#f4f2ee" : "#1e1e24";
    ctx.fillText(label, bx + 8, by + 15);
  }
}

/**
 * The Lead Finder radar (landing v2 part B.5): a map around the sample shop (dots, a lake, roads, rings at 3, 6 and 10 km with ticks), the sweep with its trail, every business it checks lighting up for a moment, four found businesses
 * with a ping, a colour and a name tag, and "Found on this sweep" filling in as the sweep passes each one, with its decision ("Call now", "Ask you first", "Skip"). The city picker changes the map's area names. On a phone the map is
 * square and cropped to the rings. Reduced motion: the whole sweep done, still. Every name is a real area of the city; the businesses are examples.
 */
export function RadarFinder({ w }: { w: W }) {
  const [city, setCity] = React.useState<City>("Hyderabad");
  const [since, setSince] = React.useState(0);
  const [tick, setTick] = React.useState(0);
  const calm = React.useSyncExternalStore(
    () => () => undefined,
    isCalm,
    () => false,
  );
  const live = React.useRef({ city, since });
  React.useEffect(() => {
    live.current = { city, since };
  });
  const desk = React.useRef<HTMLCanvasElement>(null);
  const phone = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const sans = desk.current ? fontOf(desk.current, "sans") : '"Plus Jakarta Sans", system-ui, sans-serif';
    const offs = [desk.current && addScene(desk.current, (c, W, H, t, look) => drawRadar(c, W, H, t, look, live.current, false, sans)), phone.current && addScene(phone.current, (c, W, H, t, look) => drawRadar(c, W, H, t, look, live.current, true, sans))];
    return () => offs.forEach((o) => o?.());
  }, []);
  // the found list follows the sweep: read its angle a few times a second
  React.useEffect(() => {
    if (calm) return;
    const id = window.setInterval(() => setTick(sceneTime()), 250);
    return () => window.clearInterval(id);
  }, [calm]);
  const st = calm ? { a: TAU, fresh: false } : sweepAt(tick, since);
  const seen = PINS.filter((p) => !st.fresh || st.a >= p.ang);
  const checked = st.fresh ? Math.floor((CANDS.length * st.a) / TAU) : CANDS.length;
  const worth = seen.filter((p) => p.d === "call").length;
  const chip = (d: Pin["d"]) => (d === "call" ? "bg-[#ff773c] text-[#1e1e24]" : d === "ask" ? "bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--v2-ink)]" : "bg-surface-2 text-muted");
  const pick = (c: City) => {
    setCity(c);
    setSince(sceneTime());
  };
  const cities = (
    <div role="radiogroup" aria-label={w["h2.finder.city"]} className="flex gap-0.5">
      {CITIES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={city === c} onClick={() => pick(c)} data-city={c} className={`min-h-11 rounded-full px-3 text-[13px] font-extrabold ${city === c ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
          {c}
        </button>
      ))}
    </div>
  );
  const legend = (
    <div className="flex gap-3.5 text-xs font-bold">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-[9px] rounded-full bg-[#ff773c]" />
        {w["h2.finder.call"]}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-[9px] rounded-full shadow-[inset_0_0_0_2px_var(--v2-ink)]" />
        {w["h2.finder.ask"]}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-[9px] rounded-full bg-[#a9a5a0]" />
        {w["h2.finder.skip"]}
      </span>
    </div>
  );
  return (
    <div className="grid overflow-hidden rounded-[28px] border border-line bg-surface shadow-[0_60px_120px_-70px_rgba(30,30,36,.5)] lg:grid-cols-[minmax(0,780px)_minmax(0,1fr)]" data-part="radar" data-city={city}>
      <div className="bg-[radial-gradient(circle_at_50%_50%,var(--v2-surface),var(--v2-surface-2)_70%)] lg:flex lg:items-center">
        {/* desktop: the full map */}
        <div className="relative hidden aspect-[780/520] w-full overflow-hidden lg:block">
          <canvas ref={desk} aria-hidden="true" className="absolute inset-0 block size-full" />
          <span className="absolute left-1/2 top-1/2 block size-[52px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full shadow-[0_0_0_6px_rgba(255,255,255,.8),0_14px_30px_-10px_rgba(194,65,12,.7)]">
            <AssistantOrb state="thinking" />
          </span>
          <div className="h2-glass absolute left-[18px] top-[18px] flex items-center gap-2.5 rounded-[14px] px-3.5 py-2.5 text-sm font-bold">
            <span className="h2-blink" />
            {fill(w["h2.finder.near"], { city })}
          </div>
          <div className="h2-glass absolute right-[18px] top-[18px] rounded-[14px] p-1">{cities}</div>
          <div className="h2-glass absolute bottom-[18px] left-[18px] rounded-[14px] px-3.5 py-2.5 text-sm font-semibold tabular-nums" data-part="checked">
            {fill(w["h2.finder.checked"], { n: String(checked), worth: String(worth) })}
          </div>
          <div className="h2-glass absolute bottom-[18px] right-[18px] rounded-[14px] px-3.5 py-2.5">{legend}</div>
        </div>
        {/* phone: square, cropped to the rings */}
        <div className="lg:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
            <span className="inline-flex items-center gap-2 text-sm font-bold">
              <span className="h2-blink" />
              {fill(w["h2.finder.near"], { city })}
            </span>
            <div className="overflow-x-auto">{cities}</div>
          </div>
          <div className="relative aspect-square w-full overflow-hidden bg-[radial-gradient(circle_at_50%_50%,var(--v2-surface),var(--v2-surface-2)_70%)]">
            <canvas ref={phone} aria-hidden="true" className="absolute inset-0 block size-full" />
            <span className="absolute left-1/2 top-1/2 block size-10 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full shadow-[0_0_0_5px_rgba(255,255,255,.8),0_10px_24px_-8px_rgba(194,65,12,.7)]">
              <AssistantOrb state="thinking" />
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-3 text-sm font-semibold tabular-nums">
            <span>{fill(w["h2.finder.checked"], { n: String(checked), worth: String(worth) })}</span>
            {legend}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 border-line bg-surface-2/50 p-[22px] max-lg:border-t lg:border-l" aria-live="polite">
        <div className="mb-1 flex items-center justify-between">
          <p className="m-0 font-extrabold">{w["h2.finder.list"]}</p>
          <span className="text-[13px] tabular-nums text-muted">{fill(w["h2.finder.of"], { n: String(seen.length) })}</span>
        </div>
        {[...seen]
          .sort((a, b) => a.id - b.id)
          .map((p) => (
            <div key={`${city}-${p.id}`} className="h2-pop flex flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3.5" data-found={p.id}>
              <div className="flex items-center justify-between gap-2">
                <p className="m-0 text-[15px] font-extrabold">
                  {w[`h2.finder.pin.${p.id + 1}.what`]}, {AREAS[city][p.id]}
                </p>
                <span className="whitespace-nowrap text-xs tabular-nums text-muted">{p.km}</span>
              </div>
              <p className="m-0 text-[13px] leading-snug text-muted">{w[`h2.finder.pin.${p.id + 1}.why`]}</p>
              <span className={`self-start rounded-full px-2.5 py-1 text-xs font-extrabold ${chip(p.d)}`}>{w[`h2.finder.${p.d}`]}</span>
            </div>
          ))}
        {seen.length === 0 ? <p className="m-0 text-sm text-muted">{w["h2.finder.empty"]}</p> : null}
      </div>
    </div>
  );
}

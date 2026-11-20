"use client";

import * as React from "react";

import { addScene, fontOf, isCalm, sceneTime, type Look } from "./scene";

type W = Readonly<Record<string, string>>;
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
// the three found on this sweep (the design's four, one fewer, 21 Nov): where they sit on the 780 × 520 map, how far, and the decision
const PINS: Pin[] = [
  { id: 0, x: 505, y: 165, km: "3.2 km", d: "call" as const },
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
  // the phone draws the square at about 0.6 of the desktop's size: its words, pins and tags are scaled back up to the desktop's sizes on screen (f: map units per CSS pixel; u: the pins)
  const f = crop ? 520 / (W / look.dpr) : 1;
  const u = crop ? Math.max(1, f * 0.9) : 1;
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
  ctx.font = `600 ${12 * f}px ${sans}`;
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
    ctx.fillText(label, cx + 6 * f, cy - rr + 16 * f);
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
    g.addColorStop(0, "rgba(194,65,12,0)");
    g.addColorStop((1.3 / TAU) * 0.6, "rgba(194,65,12,.08)");
    g.addColorStop(1.3 / TAU, "rgba(194,65,12,.32)");
    g.addColorStop(1.3 / TAU + 0.002, "rgba(194,65,12,0)");
    g.addColorStop(1, "rgba(194,65,12,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
  }
  const ex = cx + Math.cos(a) * R;
  const ey = cy + Math.sin(a) * R;
  const lg = ctx.createLinearGradient(cx, cy, ex, ey);
  lg.addColorStop(0, "rgba(194,65,12,.1)");
  lg.addColorStop(1, "rgba(194,65,12,.95)");
  ctx.strokeStyle = lg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.fillStyle = "#c2410c";
  ctx.beginPath();
  ctx.arc(ex, ey, 4 * u, 0, TAU);
  ctx.fill();
  // the sample shop at the centre: a white disc with an orange ring and dot (a plain marker; the orb is not drawn here)
  ctx.fillStyle = look.dark ? "#1f1e23" : "#fff";
  ctx.beginPath();
  ctx.arc(cx, cy, 13 * u, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#c2410c";
  ctx.lineWidth = 2.5 * u;
  ctx.stroke();
  ctx.fillStyle = "#c2410c";
  ctx.beginPath();
  ctx.arc(cx, cy, 5 * u, 0, TAU);
  ctx.fill();
  // every business the sweep checks lights up for a moment
  for (const c of CANDS) {
    const behind = (((a - c.ang) % TAU) + TAU) % TAU;
    const b = look.calm ? 0 : Math.max(0, 1 - behind / 1.4);
    ctx.fillStyle = b > 0 ? `rgba(194,65,12,${0.25 + b * 0.7})` : `rgba(${ink},.18)`;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 2 + b * 1.5, 0, TAU);
    ctx.fill();
  }
  // the ones worth knowing about: a ping, a coloured pin, a name tag
  const names = AREAS[state.city];
  for (const p of PINS) {
    if (st.fresh && a < p.ang) continue;
    const col = p.d === "call" ? "194,65,12" : p.d === "ask" ? ink : "169,165,160";
    ctx.fillStyle = look.dark ? "#1f1e23" : "#fff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9 * u, 0, TAU);
    ctx.fill();
    if (p.d === "ask") {
      ctx.strokeStyle = `rgb(${ink})`;
      ctx.lineWidth = 2.5 * u;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5.5 * u, 0, TAU);
      ctx.stroke();
    } else {
      ctx.fillStyle = `rgb(${col})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6.5 * u, 0, TAU);
      ctx.fill();
    }
    ctx.font = `700 ${13 * f}px ${sans}`;
    const label = names[p.id];
    const tw = ctx.measureText(label).width;
    const bw = tw + 16 * f;
    // the tag sits up and right of its pin; where the radar's edge would cut it off it flips to the pin's left, level with the pin (so it never lands on a neighbour's tag above)
    const right = crop ? 650 : 780;
    const flip = p.x + 14 * u + bw > right - 6 * f;
    const bx = flip ? p.x - 14 * u - bw : p.x + 14 * u;
    const by = flip ? p.y - 11 * f : p.y - 26 * f;
    ctx.fillStyle = look.dark ? "rgba(39,38,44,.95)" : "rgba(255,255,255,.95)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, 22 * f, 8 * f);
    else ctx.rect(bx, by, bw, 22 * f);
    ctx.fill();
    ctx.strokeStyle = look.dark ? "rgba(244,242,238,.2)" : "rgba(30,30,36,.14)";
    ctx.lineWidth = 1 * f;
    ctx.stroke();
    ctx.fillStyle = look.dark ? "#f4f2ee" : "#1e1e24";
    ctx.fillText(label, bx + 8 * f, by + 15 * f);
  }
}

/**
 * The Lead Finder radar (landing v2 part B.5, calmed for the phone, 21 Nov): a map around the sample shop (dots, a lake, roads, rings at 3, 6 and 10 km), the sweep with its trail, every business it checks lighting up for a moment, three found businesses with a
 * colour and a name tag, and two result rows under the map (one "Contact", one "Check first"). The city picker (one swipe row, never wrapping) changes the map's area names. The map is the full width of its card; on a phone it is square and cropped to the rings.
 * One steady speed, no glow, paused off screen (scene.ts); reduced motion: the whole sweep done, still. A small "Example" tag says the businesses are samples. Every name is a real area of the city.
 */
export function RadarFinder({ w }: { w: W }) {
  const [city, setCity] = React.useState<City>("Hyderabad");
  const live = React.useRef({ city, since: 0 });
  const desk = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const sans = desk.current ? fontOf(desk.current, "sans") : '"Plus Jakarta Sans", system-ui, sans-serif';
    // one canvas at every width: wide, it draws the whole 780 x 520 map; in a narrow box (a phone) it crops to the rings, with its words and pins drawn larger, so they stay readable
    const off = desk.current ? addScene(desk.current, (c, W, H, t, look) => drawRadar(c, W, H, t, look, live.current, W / H < 1.2, sans)) : undefined;
    return () => off?.();
  }, []);
  const pick = (c: City, el: HTMLElement) => {
    setCity(c);
    live.current = { city: c, since: sceneTime() }; // a new city starts a fresh sweep
    // the picked city comes fully into view in the swipe row
    el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: isCalm() ? "auto" : "smooth" });
  };
  const rows = [PINS.find((p) => p.d === "call"), PINS.find((p) => p.d === "ask")].filter((p): p is Pin => p !== undefined);
  return (
    <div className="h4-radar" data-part="radar" data-city={city}>
      <div className="h4-panel h4-radar-card">
        <div className="h4-cities-wrap">
          <div role="radiogroup" aria-label={w["h2.finder.city"]} className="h4-cities">
            {CITIES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={city === c} onClick={(e) => pick(c, e.currentTarget)} data-city={c} className="h4-city">
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="h4-radar-map">
          <canvas ref={desk} aria-hidden="true" className="absolute inset-0 block size-full" />
          <span className="h4-eg">{w["h4.eg"]}</span>
        </div>
        <ul className="h4-found-list">
          {rows.map((p) => (
            <li key={`${city}-${p.id}`} className="h4-fc" data-found={p.id}>
              <p className="h4-fc-top">
                <b>
                  {w[`h2.finder.pin.${p.id + 1}.what`]}, {AREAS[city][p.id]}
                </b>
                <span className={`h4-chip ${p.d === "call" ? "h4-chip-call" : "h4-chip-ask"}`}>{w[`h2.finder.${p.d}`]}</span>
              </p>
              <p className="h4-fc-why">
                <span className="h4-fc-km">{p.km}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

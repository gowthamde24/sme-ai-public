"use client";

import * as React from "react";

import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";

import { addScene, inkOf, isCalm, sceneTime, type Look } from "./scene";

type W = Readonly<Record<string, string>>;
const TAU = 6.2832;
// the six stops on the design's 1240 × 440 road
const STOPS = [
  { x: 70, y: 300 },
  { x: 290, y: 190 },
  { x: 530, y: 285 },
  { x: 770, y: 175 },
  { x: 990, y: 265 },
  { x: 1175, y: 160 },
];
// the road: Catmull-Rom through the stops, 60 samples a segment
const ROAD: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let i = 0; i < STOPS.length - 1; i++) {
    const p0 = STOPS[Math.max(0, i - 1)];
    const p1 = STOPS[i];
    const p2 = STOPS[i + 1];
    const p3 = STOPS[Math.min(STOPS.length - 1, i + 2)];
    for (let s = 0; s < 60; s++) {
      const u = s / 60;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
      out.push([f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y)]);
    }
  }
  out.push([STOPS[5].x, STOPS[5].y]);
  return out;
})();
// the clock of one journey: [seconds, road sample]; a pair with the same sample is a rest at that stop (the quote rests longest: first waiting for the owner, then approved)
const KEYS: [number, number][] = [[0, 0], [0.8, 0], [1.8, 60], [2.6, 60], [3.6, 120], [5.8, 120], [6.8, 180], [7.6, 180], [8.6, 240], [9.4, 240], [10.4, 300], [12.6, 300]];
const LOOP = KEYS[KEYS.length - 1][0];
/** Where the enquiry is on the road at a moment, and the stop it rests at (with how long it has rested), or -1. */
export function journeyAt(t: number, calm: boolean): { cur: number; at: number; since: number } {
  if (calm) return { cur: 300, at: 5, since: 2 };
  const tt = t % LOOP;
  let cur = 0;
  let at = -1;
  let since = 0;
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (tt >= KEYS[i][0] && tt < KEYS[i + 1][0]) {
      const u = (tt - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]);
      const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      cur = KEYS[i][1] + (KEYS[i + 1][1] - KEYS[i][1]) * e;
      if (KEYS[i][1] === KEYS[i + 1][1]) {
        at = KEYS[i][1] / 60;
        since = tt - KEYS[i][0];
      }
      break;
    }
  }
  return { cur, at, since };
}

function drawRoad(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, look: Look): void {
  const k = W / 1240;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const ink = inkOf(look);
  const { cur } = journeyAt(t, look.calm);
  const ci = Math.min(ROAD.length - 1, Math.round(cur));
  // where calling tools stop: a grey branch after the call, ending in a cross (its words are on the page, beside it)
  const c = STOPS[1];
  ctx.setLineDash([3, 7]);
  ctx.strokeStyle = `rgba(${ink},.28)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.bezierCurveTo(c.x + 30, c.y + 60, c.x + 40, c.y + 120, c.x + 20, c.y + 170);
  ctx.stroke();
  ctx.setLineDash([]);
  const xx = c.x + 20;
  const xy = c.y + 170;
  ctx.strokeStyle = `rgba(${ink},.45)`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(xx - 7, xy - 7);
  ctx.lineTo(xx + 7, xy + 7);
  ctx.moveTo(xx + 7, xy - 7);
  ctx.lineTo(xx - 7, xy + 7);
  ctx.stroke();
  // the road ahead, then the road travelled, lit
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = `rgba(${ink},.06)`;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(ROAD[0][0], ROAD[0][1]);
  for (const p of ROAD) ctx.lineTo(p[0], p[1]);
  ctx.stroke();
  ctx.setLineDash([2, 8]);
  ctx.strokeStyle = `rgba(${ink},.22)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
  if (ci > 0) {
    const g = ctx.createLinearGradient(ROAD[0][0], 0, ROAD[ROAD.length - 1][0], 0);
    g.addColorStop(0, "#ff9a6b");
    g.addColorStop(0.55, "#ff773c");
    g.addColorStop(1, "#ec486e");
    ctx.strokeStyle = g;
    ctx.lineWidth = 4;
    ctx.shadowColor = "rgba(255,119,60,.6)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(ROAD[0][0], ROAD[0][1]);
    for (let i = 1; i <= ci; i++) ctx.lineTo(ROAD[i][0], ROAD[i][1]);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  STOPS.forEach((n, i) => {
    const reached = ci >= i * 60;
    ctx.fillStyle = look.dark ? "#27262c" : "#fff";
    ctx.shadowColor = "rgba(30,30,36,.18)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(n.x, n.y, 15, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (reached) {
      const g = ctx.createRadialGradient(n.x - 3, n.y - 3, 1, n.x, n.y, 9);
      g.addColorStop(0, "#ffb38f");
      g.addColorStop(1, i > 3 ? "#ec486e" : "#f0652a");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 9, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#c9c4bc";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 7, 0, TAU);
      ctx.stroke();
    }
  });
  // the enquiry itself: a glowing spark with a tail
  for (let j = 26; j >= 0; j--) {
    const p = ROAD[Math.max(0, ci - j)];
    ctx.fillStyle = `rgba(255,119,60,${(1 - j / 27) * 0.8})`;
    if (j === 0) {
      ctx.shadowColor = "rgba(255,119,60,1)";
      ctx.shadowBlur = 22;
    }
    ctx.beginPath();
    ctx.arc(p[0], p[1], j === 0 ? 7 : 5 - j * 0.15, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/**
 * After the call (landing v2 part B.7): one enquiry's journey as a lit road through six stops (the enquiry, the call, the quote, the visit, the follow-ups, the order), with a tag at the stop it rests on. It waits at the quote
 * ("Quote ready. Waiting for your OK", then "Approved by you"). A grey branch after the call shows where calling tools stop. On a phone: a vertical timeline. Then the "You, teaching it" pill, typing a rule. The words are
 * the page's (server markup); the canvas draws the road and the dots only. Reduced motion: the whole journey done, still. An example enquiry for a sample business.
 */
export function Journey({ w }: { w: W }) {
  const [tick, setTick] = React.useState(0);
  const calm = React.useSyncExternalStore(
    () => () => undefined,
    isCalm,
    () => false,
  );
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => (canvas.current ? addScene(canvas.current, drawRoad) : undefined), []);
  React.useEffect(() => {
    if (calm) return;
    const id = window.setInterval(() => setTick(sceneTime()), 200);
    return () => window.clearInterval(id);
  }, [calm]);
  const j = journeyAt(tick, calm);
  const reached = (i: number) => j.cur >= i * 60;
  const tagOf = (i: number) => (i === 2 ? (j.at === 2 && j.since < 1.2 ? w["h2.after.wait"] : w["h2.after.approved"]) : w[`h2.after.${i + 1}.tag`]);
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
  const fillPct = Math.round((j.cur / 300) * 100);
  return (
    <div data-part="journey" data-at={j.at}>
      {/* desktop: the road */}
      <div className="hidden lg:block">
        <div style={{ position: "relative", width: "100%", aspectRatio: "1240 / 440" }}>
          <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 block size-full" />
          <div style={{ position: "absolute", left: pct(STOPS[1].x + 36, 1240), top: pct(STOPS[1].y + 160, 440) }}>
            <span className="text-[13px] font-semibold text-muted">{w["h2.after.stop"]}</span>
          </div>
          <ol className="contents">
            {STOPS.map((s, i) => (
              <li key={i} style={{ position: "absolute", left: pct(s.x, 1240), top: pct(s.y + 26, 440), transform: "translateX(-50%)" }}>
                <span className={`block whitespace-nowrap text-center font-display text-[17px] font-extrabold ${reached(i) ? "text-ink" : "text-muted/70"}`} data-stop={i} data-reached={reached(i) ? "" : undefined}>
                  {w[`h2.after.${i + 1}.name`]}
                </span>
                <span className={`block whitespace-nowrap text-center text-[13px] font-medium ${reached(i) ? "text-muted" : "text-muted/60"}`}>{w[`h2.after.${i + 1}.desc`]}</span>
              </li>
            ))}
          </ol>
          {j.at >= 0 ? (
            <div style={{ position: "absolute", left: pct(STOPS[j.at].x, 1240), top: pct(STOPS[j.at].y - 74, 440), transform: "translateX(-50%)" }}>
              <span key={`${j.at}-${tagOf(j.at)}`} className="h2-pop flex items-center gap-2 whitespace-nowrap rounded-full border border-[rgba(255,119,60,.45)] bg-surface/95 px-4 py-2.5 text-sm font-bold shadow-[0_8px_24px_rgba(30,30,36,.22)]" aria-live="polite" data-part="tag">
                {j.at === 2 && j.since >= 1.2 ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff773c" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
                {tagOf(j.at)}
                {j.at === 2 && j.since < 1.2 ? <span className="rounded-full bg-[#ff773c] px-3.5 py-1 text-[13px] font-extrabold text-[#1e1e24]">{w["h2.after.approve"]}</span> : null}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      {/* phone: a vertical timeline */}
      <div className="relative mt-5 pl-1 lg:hidden">
        <span aria-hidden="true" className="absolute bottom-2.5 left-2 top-2.5 w-0.5 rounded-sm bg-ink/10" />
        <span aria-hidden="true" style={{ position: "absolute", left: 8, top: 10, width: 2, height: `${fillPct}%` }}>
          <span className="block size-full rounded-sm bg-[linear-gradient(#ff9a6b,#ff773c,#ec486e)]" />
        </span>
        <ol className="relative flex flex-col gap-[22px]">
          {STOPS.map((_, i) => (
            <li key={i} className="flex items-start gap-4">
              <span className={`mt-0.5 size-[18px] shrink-0 rounded-full transition-colors ${reached(i) ? "bg-[#ff773c] shadow-[0_0_0_5px_rgba(255,119,60,.2)]" : "bg-surface shadow-[0_0_0_1.5px_#c9c4bc]"}`} />
              <div className="flex flex-col gap-1">
                <p className={`m-0 font-display text-[17px] font-extrabold ${reached(i) ? "text-ink" : "text-muted/70"}`}>{w[`h2.after.${i + 1}.name`]}</p>
                <p className="m-0 text-sm text-muted">{w[`h2.after.${i + 1}.desc`]}</p>
                {Math.floor(j.cur / 60) === i ? <span className="h2-glass h2-pop self-start rounded-full px-3 py-1.5 text-[13px] font-bold">{tagOf(i)}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {/* you, teaching it */}
      <div className="mt-6 flex justify-center">
        <div className="h2-glass inline-flex max-w-full flex-wrap items-center gap-x-3.5 gap-y-1 rounded-[22px] p-3 lg:flex-nowrap lg:rounded-full lg:py-2 lg:pl-2 lg:pr-[22px]" data-part="teach">
          <span className="block size-10 shrink-0 overflow-hidden rounded-full">
            <AssistantOrb state="listening" />
          </span>
          <span className="whitespace-nowrap text-sm font-bold text-brand-text">{w["h2.after.teach"]}</span>
          <span className="h2-typeline basis-full text-base font-semibold lg:basis-auto">{w["h2.after.rule"]}</span>
        </div>
      </div>
    </div>
  );
}
